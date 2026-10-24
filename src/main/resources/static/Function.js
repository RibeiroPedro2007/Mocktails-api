// ============================================================================
// Function.js - Operation screen logic. Loaded by templates/Operation.html.
//
// How it works:
//   1. The page starts with empty containers (menu, machine panel, order list).
//   2. This script loads drinks and orders from the REST API and keeps them in "state".
//   3. It subscribes to WebSocket topics (STOMP) to receive live updates.
//   4. Every change goes into "state" first, then the render functions redraw the screen.
//
// Add ?mock=1 to the URL to run the screen without the ESP32 (fake data, no server calls).
// ============================================================================

// ---------- Configuration ----------

// true when the URL contains ?mock=1
const MOCK = new URLSearchParams(location.search).has('mock');
// If true, drinks stay blocked while the machine is offline.
const REQUIRE_MACHINE = true; // set to false while the ESP32 does not report its status yet

// Every endpoint and topic in one place: if the back end changes, only edit here.
const API = {
  drinks: '/api/drinks',            // GET  -> active drinks with recipes and ingredient stock
  orders: '/api/orders',            // GET  -> all orders | POST { drinkId } -> new order
  socket: '/ws-mocktails',          // STOMP over SockJS (StompWebSocketConfig)
  topicOrders: '/topic/orders',     // Order objects (OrderWebSocketPublisher)
  topicMachine: '/topic/machine',   // { connected, cupPresent, progress, orderId } (to be published)
                                    // cupPresent is null while idle: the sensor only runs during an order
};
// Text shown for each order status sent by the back end.
const STATUS = { PENDING: 'Queued', IN_PREPARATION: 'Preparing', COMPLETED: 'Completed', ERROR: 'Error', CANCELLED: 'Cancelled' };
// Statuses that mean "the machine is working on it or is about to".
const ACTIVE = ['PENDING', 'IN_PREPARATION'];
const MAX_GAUGE = 20; // servings that fill a stock gauge completely
const GLASS_H = 143;  // liquid height inside the glass, in SVG units

// ---------- State ----------
// Single source of truth. Never edit the screen directly: change the state, then call a render function.
const state = {
  drinks: [],      // drinks from /api/drinks
  orders: [],      // the 10 most recent orders, newest first
  loaded: MOCK,    // false until the first load finishes (shows "Loading menu...")
  sending: false,  // true while a new order request is in flight (prevents double clicks)
  machine: { connected: false, cupPresent: null, progress: 0, orderId: null },
};

// ---------- Helpers ----------

// Shortcut for document.getElementById.
const $ = (id) => document.getElementById(id);

// Escapes HTML special characters. Needed because texts (like drink names) are inserted
// with innerHTML; without this, a name containing "<script>" could run code (XSS).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Turns a drink name into a color: the same name always gives the same hue (0-359),
// so each drink keeps its own color without storing it in the database.
const tint = (name) => `hsl(${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 52%)`;

// True if any order is queued or being prepared.
const busy = () => state.orders.some((o) => ACTIVE.includes(o.status));

// How many drinks the current stock can make: the scarcest ingredient decides.
// Example: 600 ml of lime / 60 ml per drink = 10, but 100 ml of soda / 140 ml = 0, so the result is 0.
const servings = (d) => (d.recipes?.length
  ? Math.min(...d.recipes.map((r) => Math.floor(r.ingredient.currentQuantityMl / r.quantityMl)))
  : 0);

// LocalDateTime arrives as an ISO string or, depending on Jackson settings, as [y, m, d, h, min, s].
// Months in JavaScript start at 0, hence the "- 1".
const toDate = (v) => (Array.isArray(v) ? new Date(v[0], v[1] - 1, v[2], v[3] ?? 0, v[4] ?? 0, v[5] ?? 0) : new Date(v));

// fetch() wrapper: sends/receives JSON and turns HTTP errors (like 500) into JavaScript errors.
async function http(url, opts) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

// Shows a message at the bottom of the screen for 4 seconds (the #toast element).
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t); // restart the timer if another message arrives
  toast.t = setTimeout(() => el.classList.remove('show'), 4000);
}

/* ---------- rendering ---------- */

// Why a drink cannot be prepared right now, or null if it can.
// The order of the checks matters: the first one that matches wins.
function blockReason(d) {
  const m = state.machine;
  if (servings(d) < 1) return 'Out of stock';
  if (REQUIRE_MACHINE && !m.connected) return 'Machine offline';
  if (busy() || state.sending) return 'Machine busy';
  return null;
}

// Draws the drink cards. Rebuilds the whole grid, so it should not run at high frequency.
function renderDrinks() {
  const list = state.drinks.filter((d) => d.active !== false);
  if (!list.length) {
    $('drinks').innerHTML = `<p class="empty-msg">${state.loaded ? 'No drinks on the menu yet. Add one in Management.' : 'Loading menu…'}</p>`;
    return;
  }
  $('drinks').innerHTML = list.map((d) => {
    const n = servings(d);
    const why = blockReason(d);
    // --c and --lvl are CSS variables used by the stock gauge (see Style.css).
    return `<article class="drink${n < 1 ? ' empty' : ''}" style="--c:${tint(d.name)};--lvl:${Math.min(n, MAX_GAUGE) / MAX_GAUGE * 100}%">
      <span class="gauge"><i></i></span>
      <div class="body">
        <h3>${esc(d.name)}</h3>
        <p class="stock">${n < 1 ? 'Not enough supplies' : `Enough for ${n} ${n === 1 ? 'drink' : 'drinks'}`}</p>
        <button class="prepare" data-id="${d.id}" ${why ? 'disabled' : ''}>${why ?? 'Prepare drink'}</button>
      </div>
    </article>`;
  }).join('');
}

// Updates the machine panel: connection badge, glass, percentage and cup sensor.
// It only changes existing elements (no rebuild), so it is cheap enough for progress updates.
function renderMachine() {
  const m = state.machine;
  const current = state.orders.find((o) => ACTIVE.includes(o.status)); // order in progress, if any
  $('conn').className = `pill ${m.connected ? 'on' : ''}`;
  $('conn').textContent = m.connected ? 'Machine online' : 'Machine offline';
  // Liquid color follows the drink being prepared.
  if (current?.drink) $('glass').style.setProperty('--liquid', tint(current.drink.name));
  // Moves the liquid rectangle: 0% pushes it fully below the glass, 100% leaves it at the top.
  $('liquid').style.transform = `translateY(${GLASS_H * (1 - m.progress / 100)}px)`;
  $('glass').setAttribute('aria-valuenow', Math.round(m.progress)); // for screen readers
  $('m-pct').textContent = `${Math.round(m.progress)}%`;
  $('m-state').textContent = !m.connected ? 'Machine offline' : current ? `Preparing ${current.drink?.name ?? 'drink'}` : 'Ready';
  // The sensor only runs while an order is in progress, so before that there is nothing to show.
  const cup = $('m-cup');
  let text = 'Cup sensor: idle until an order starts';
  if (current) {
    text = m.cupPresent === true ? 'Cup detected'
      : m.cupPresent === false ? 'No cup detected yet. The machine keeps checking.' : 'Looking for a cup…';
  }
  cup.className = `m-cup${current && m.cupPresent === false ? ' bad' : ''}`; // "bad" = red warning
  cup.textContent = text;
}

// Draws the list of the last 10 orders.
function renderOrders() {
  $('orders').innerHTML = state.orders.length ? state.orders.map((o) => `
    <li>
      <span>#${esc(o.id)} ${esc(o.drink?.name ?? 'Unknown drink')}</span>
      <span class="tag s-${String(o.status).toLowerCase()}">${STATUS[o.status] ?? esc(o.status)}</span>
      <time>${toDate(o.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
    </li>`).join('') : '<li>No orders yet.</li>';
}

// Redraws everything from the current state.
const render = () => { renderDrinks(); renderMachine(); renderOrders(); };

/* ---------- state updates ---------- */

// Keeps only the 10 newest orders (the highest ids), newest first.
const setOrders = (list) => { state.orders = list.sort((a, b) => b.id - a.id).slice(0, 10); };
// Adds an order, or replaces it if it is already in the list (same id), e.g. when its status changes.
const upsertOrder = (o) => setOrders([o, ...state.orders.filter((x) => x.id !== o.id)]);

// /topic/orders: a new or updated Order.
function onOrder(o) {
  const m = state.machine;
  upsertOrder(o);
  if (o.status === 'IN_PREPARATION') { m.orderId = o.id; m.progress = 0; } // a new drink started: empty glass
  else if (!ACTIVE.includes(o.status) && o.id === m.orderId) {
    // The current order ended: completed fills the glass, any other ending empties it.
    m.progress = o.status === 'COMPLETED' ? 100 : 0;
    // Keep the full glass visible for 2 seconds, then reset it if no other order started.
    setTimeout(() => { if (!busy()) { m.progress = 0; renderMachine(); } }, 2000);
  }
  loadDrinks(); // stock changed
  render();
}

// /topic/machine: { connected, cupPresent, progress, orderId }.
function onMachine(msg) {
  const m = state.machine;
  const cup = msg.cupPresent ?? null; // missing value means "sensor not reporting"
  const changed = m.connected !== !!msg.connected; // only this affects the drink buttons
  m.connected = !!msg.connected;
  m.cupPresent = cup;
  if (msg.progress != null) { m.progress = msg.progress; m.orderId = msg.orderId ?? m.orderId; }
  changed ? render() : renderMachine(); // progress is high frequency: avoid rebuilding the grid
}

// Loads the drinks (with stock) from the API and redraws.
async function loadDrinks() {
  if (MOCK) return; // in mock mode the data is local
  state.drinks = await http(API.drinks);
  state.loaded = true;
  render();
}

// Loads the orders from the API and redraws.
async function loadOrders() {
  if (MOCK) return;
  setOrders(await http(API.orders));
  render();
}

// Loads both in parallel. If the server cannot be reached, shows a message.
const refresh = () => Promise.all([loadDrinks(), loadOrders()]).catch(() => toast('Cannot reach the server.'));

// Opens the WebSocket connection (STOMP over SockJS) and subscribes to the topics.
function connectStomp() {
  const client = new StompJs.Client({
    webSocketFactory: () => new SockJS(API.socket),
    reconnectDelay: 3000, // if the connection drops, try again every 3 seconds
    onConnect: () => {
      client.subscribe(API.topicOrders, (frame) => onOrder(JSON.parse(frame.body)));
      client.subscribe(API.topicMachine, (frame) => onMachine(JSON.parse(frame.body)));
      refresh(); // reload in case something changed while disconnected
    },
    // Without the connection we cannot know the machine status, so show it as offline.
    onWebSocketClose: () => { state.machine.connected = false; render(); },
  });
  client.activate();
}

/* ---------- mock mode ---------- */

// Fake data and a fake machine, for testing the screen without the back end (?mock=1).
function startMock() {
  const stock = (ml) => ({ currentQuantityMl: ml });
  const lime = stock(900), passion = stock(700), soda = stock(1500), mint = stock(80);
  const use = (ingredient, quantityMl) => ({ ingredient, quantityMl }); // one recipe line
  state.drinks = [
    { id: 1, name: 'Lime juice', recipes: [use(lime, 60), use(soda, 140)] },
    { id: 2, name: 'Passion fruit', recipes: [use(passion, 80), use(soda, 120)] },
    { id: 3, name: 'Virgin mojito', recipes: [use(lime, 40), use(mint, 20), use(soda, 140)] },
    { id: 4, name: 'Mint cooler', recipes: [use(mint, 90)] }, // not enough mint: shows the out-of-stock state
  ];
  let nextId = 0;
  // Pretend the machine connects shortly after the page opens.
  setTimeout(() => onMachine({ connected: true, cupPresent: null }), 300);
  return {
    // Simulates an order: uses the stock, then fills the glass in steps of 4% every 150 ms.
    order(drinkId) {
      const drink = state.drinks.find((d) => d.id === drinkId);
      drink.recipes.forEach((r) => { r.ingredient.currentQuantityMl -= r.quantityMl; });
      const order = { id: ++nextId, drink, dateTime: new Date().toISOString(), status: 'IN_PREPARATION' };
      onOrder(order);
      let progress = 0;
      const timer = setInterval(() => {
        progress += 4;
        if (progress < 100) return onMachine({ connected: true, cupPresent: progress > 20, progress, orderId: order.id }); // no cup for the first ticks
        clearInterval(timer);
        onOrder({ ...order, status: 'COMPLETED' });
      }, 150);
    },
  };
}

/* ---------- boot ---------- */

const mock = MOCK ? startMock() : null;

// One listener on the container handles every "Prepare drink" button (event delegation).
// This works even though the buttons are recreated every time the grid is redrawn.
$('drinks').addEventListener('click', async (e) => {
  const btn = e.target.closest('.prepare');
  if (!btn || btn.disabled) return; // the click was not on an enabled button
  const drinkId = Number(btn.dataset.id); // data-id from the button
  state.sending = true; // blocks the other buttons until the request ends
  render();
  try {
    if (mock) mock.order(drinkId);
    else onOrder(await http(API.orders, { method: 'POST', body: JSON.stringify({ drinkId }) }));
  } catch (err) {
    toast(err.message || 'Could not start the drink.');
  } finally {
    state.sending = false;
    render();
  }
});

render(); // first draw, with an empty state
if (!MOCK) {
  refresh();
  setInterval(refresh, 10000); // safety net in case a WebSocket message is missed
  connectStomp();
}
