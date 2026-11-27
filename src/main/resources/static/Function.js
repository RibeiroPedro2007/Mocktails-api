// ============================================================================
// Function.js - Operation screen logic. Loaded by templates/Operation.html.
// ============================================================================

// ---------- Configuration ----------

const MOCK = new URLSearchParams(location.search).has('mock');
const REQUIRE_MACHINE = true; // set to false while the ESP32 does not report its status yet
const MAX_ORDER = 3;          // máximo de drinks por pedido

const API = {
  drinks: '/api/drinks',
  orders: '/api/orders',
  cancelOrder: (id) => `/api/orders/${id}/cancel`,
  socket: '/ws-mocktails',
  topicOrders: '/topic/orders',
  topicMachine: '/topic/esp/status',
};

const STATUS = {
  PENDING: 'Na fila',
  PREPARING: 'Em preparo',
  IN_PREPARATION: 'Em preparo',
  COMPLETED: 'Concluído',
  NEED_CUPS: 'Faltam copos',
  ERROR: 'Erro',
  CANCELLED: 'Cancelado',
  CANCELED: 'Cancelado',
};

const ACTIVE = ['PENDING', 'PREPARING', 'IN_PREPARATION', 'NEED_CUPS'];
const MAX_GAUGE = 20;
const GLASS_H = 143;

// ---------- State ----------

const state = {
  drinks: [],      // drinks from /api/drinks
  orders: [],      // the 10 most recent orders, newest first
  cart: {},        // { [drinkId]: quantidade selecionada }
  loaded: MOCK,
  sending: false,
  machine: { connected: false, cupPresent: null, progress: 0, orderId: null },
};

// ---------- Helpers ----------

const $ = (id) => document.getElementById(id);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const tint = (name) => `hsl(${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 52%)`;

const busy = () => state.orders.some((o) => ACTIVE.includes(o.status));

const ingKey = (ing) => ing?.id ?? ing?.name;
const recipeQty = (r) => Number(r.QuantityMl ?? r.quantityMl ?? 0);

// Total de bebidas atualmente selecionadas no carrinho (0..3)
const totalSelected = () => Object.values(state.cart).reduce((sum, q) => sum + q, 0);

// Estoque real de um drink (sem descontar o carrinho)
const baseServings = (d) => (d.recipes?.length
    ? Math.min(...d.recipes.map((r) => Math.floor(r.ingredient.currentQuantityMl / recipeQty(r))))
    : 0);

// Mapa de estoque restante (em ml) descontando ao vivo os drinks já selecionados no carrinho
function remainingStock() {
  const map = new Map();
  for (const d of state.drinks) {
    for (const r of d.recipes ?? []) {
      const k = ingKey(r.ingredient);
      if (!map.has(k)) map.set(k, r.ingredient.currentQuantityMl);
    }
  }
  for (const [idStr, qty] of Object.entries(state.cart)) {
    if (qty <= 0) continue;
    const drink = state.drinks.find((d) => d.id === Number(idStr));
    if (!drink) continue;
    for (const r of drink.recipes ?? []) {
      const k = ingKey(r.ingredient);
      map.set(k, Math.max(0, (map.get(k) ?? 0) - recipeQty(r) * qty));
    }
  }
  return map;
}

// Quantas doses A MAIS desse drink ainda cabem no estoque restante
function extraServings(d, stockMap) {
  if (!d.recipes?.length) return 0;
  return Math.min(...d.recipes.map((r) => {
    const avail = stockMap.get(ingKey(r.ingredient)) ?? 0;
    const need = recipeQty(r);
    return need > 0 ? Math.floor(avail / need) : 0;
  }));
}

// Remove itens do carrinho caso o estoque tenha mudado em tempo real e não comporte mais
function reconcileCart() {
  const stock = new Map();
  for (const d of state.drinks) {
    for (const r of d.recipes ?? []) {
      const k = ingKey(r.ingredient);
      if (!stock.has(k)) stock.set(k, r.ingredient.currentQuantityMl);
    }
  }

  let total = 0;
  const nextCart = {};

  for (const [idStr, qty] of Object.entries(state.cart)) {
    const id = Number(idStr);
    const drink = state.drinks.find((d) => d.id === id && d.active !== false);
    if (!drink || qty <= 0) continue;

    let kept = 0;
    for (let i = 0; i < qty && total < MAX_ORDER; i++) {
      const canMake = drink.recipes?.length && drink.recipes.every(
          (r) => (stock.get(ingKey(r.ingredient)) ?? 0) >= recipeQty(r),
      );
      if (!canMake) break;
      for (const r of drink.recipes) {
        const k = ingKey(r.ingredient);
        stock.set(k, stock.get(k) - recipeQty(r));
      }
      kept++;
      total++;
    }
    if (kept > 0) nextCart[id] = kept;
  }

  state.cart = nextCart;
}

const toDate = (v) => (Array.isArray(v)
    ? new Date(v[0], v[1] - 1, v[2], v[3] ?? 0, v[4] ?? 0, v[5] ?? 0)
    : new Date(v));

async function http(url, opts) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Falha na requisição (${res.status})`);
  }
  return res.json();
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 4000);
}

/* ---------- rendering ---------- */

// Retorna o motivo de bloqueio global da tela (afeta todos os cards e o botão principal)
function globalBlock() {
  if (REQUIRE_MACHINE && !state.machine.connected) return 'offline';
  if (state.sending) return 'sending';
  if (busy()) return 'busy';
  return null;
}

function renderDrinks() {
  const list = state.drinks.filter((d) => d.active !== false);
  if (!list.length) {
    $('drinks').innerHTML = `<p class="empty-msg">${state.loaded ? 'Nenhuma bebida no cardápio. Cadastre uma em Gerenciamento.' : 'Carregando cardápio…'}</p>`;
    return;
  }

  const block = globalBlock();
  const total = totalSelected();
  const stockMap = remainingStock();

  $('drinks').innerHTML = list.map((d) => {
    const qty = state.cart[d.id] || 0;
    const base = baseServings(d);
    const extra = extraServings(d, stockMap);

    const canDec = !block && qty > 0;
    const canInc = !block && total < MAX_ORDER && extra >= 1;

    // Fica escuro e sem cor se:
    // - máquina offline / ocupada / enviando
    // - sem insumo e nada selecionado
    // - atingiu o limite (3/3) e este card está zerado
    const unavailable = Boolean(block) || (qty === 0 && (!canInc || base < 1));

    let stockText;
    if (base < 1) {
      stockText = 'Insumos insuficientes';
    } else if (extra < 1) {
      stockText = qty > 0 ? 'Limite de insumos atingido' : 'Insumos reservados no pedido';
    } else {
      stockText = `Dá para ${extra} ${extra === 1 ? 'bebida' : 'bebidas'}`;
    }

    const classes = ['drink'];
    if (unavailable) classes.push('unavailable');
    if (qty > 0 && !block) classes.push('selected');

    return `<article class="${classes.join(' ')}" style="--c:${tint(d.name)};--lvl:${Math.min(extra, MAX_GAUGE) / MAX_GAUGE * 100}%">
      <span class="gauge"><i></i></span>
      <div class="body">
        <h3>${esc(d.name)}</h3>
        <p class="stock">${stockText}</p>
        <div class="stepper" role="group" aria-label="Quantidade de ${esc(d.name)}">
          <button type="button" class="step-btn" data-action="dec" data-id="${d.id}" ${canDec ? '' : 'disabled'} aria-label="Remover ${esc(d.name)}">−</button>
          <span class="step-val" aria-live="polite">${qty}</span>
          <button type="button" class="step-btn" data-action="inc" data-id="${d.id}" ${canInc ? '' : 'disabled'} aria-label="Adicionar ${esc(d.name)}">+</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

function renderOrderBar() {
  const bar = $('order-bar');
  const countEl = $('order-count');
  const summaryEl = $('order-summary');
  const clearBtn = $('clear-order');
  const submitBtn = $('submit-order');

  const block = globalBlock();
  const total = totalSelected();

  const items = Object.entries(state.cart)
      .filter(([, q]) => q > 0)
      .map(([idStr, q]) => {
        const drink = state.drinks.find((d) => d.id === Number(idStr));
        return `${q}× ${drink?.name ?? 'Bebida'}`;
      });

  countEl.textContent = `${total}/${MAX_ORDER} selecionados`;

  if (block === 'offline') {
    summaryEl.textContent = 'Conecte a máquina para montar um pedido';
  } else if (block === 'busy') {
    const activeCount = state.orders.filter((o) => ACTIVE.includes(o.status)).length;
    summaryEl.textContent = `Aguardando preparo atual (${activeCount} na fila)`;
  } else if (items.length) {
    summaryEl.textContent = items.join(' · ');
  } else {
    summaryEl.textContent = `Selecione até ${MAX_ORDER} bebidas no cardápio`;
  }

  clearBtn.disabled = Boolean(block) || total === 0;

  if (block === 'offline') {
    submitBtn.textContent = 'Máquina offline';
    submitBtn.disabled = true;
  } else if (block === 'sending') {
    submitBtn.textContent = 'Enviando pedido…';
    submitBtn.disabled = true;
  } else if (block === 'busy') {
    submitBtn.textContent = 'Máquina ocupada';
    submitBtn.disabled = true;
  } else if (total === 0) {
    submitBtn.textContent = 'Preparar pedido';
    submitBtn.disabled = true;
  } else {
    submitBtn.textContent = `Preparar pedido (${total})`;
    submitBtn.disabled = false;
  }

  bar.classList.toggle('is-offline', block === 'offline');
  bar.classList.toggle('is-ready', !block && total > 0);
}

// Acha o pedido realmente em preparo (ou o PENDING mais antigo da fila)
function findCurrentOrder() {
  const m = state.machine;
  const active = state.orders.filter((o) => ACTIVE.includes(o.status));
  if (!active.length) return null;

  return (
      active.find((o) => o.status === 'IN_PREPARATION' || o.status === 'PREPARING' || o.status === 'NEED_CUPS')
      || active.find((o) => Number(o.id) === Number(m.orderId))
      || [...active].sort((a, b) => a.id - b.id)[0]
  );
}

function renderMachine() {
  const m = state.machine;
  const activeOrders = state.orders.filter((o) => ACTIVE.includes(o.status));
  const current = findCurrentOrder();

  $('conn').className = `pill ${m.connected ? 'on' : ''}`;
  $('conn').textContent = m.connected ? 'Máquina online' : 'Máquina offline';

  if (current?.drink) $('glass').style.setProperty('--liquid', tint(current.drink.name));
  $('liquid').style.transform = `translateY(${GLASS_H * (1 - m.progress / 100)}px)`;
  $('glass').setAttribute('aria-valuenow', Math.round(m.progress));
  $('m-pct').textContent = `${Math.round(m.progress)}%`;

  if (!m.connected) {
    $('m-state').textContent = 'Máquina offline';
  } else if (current) {
    const remaining = activeOrders.length - 1;
    const queueSuffix = remaining > 0 ? ` (+${remaining} na fila)` : '';
    $('m-state').textContent = `Preparando ${current.drink?.name ?? 'bebida'}${queueSuffix}`;
  } else {
    $('m-state').textContent = 'Pronta';
  }

  const cup = $('m-cup');
  let text = 'Sensor de copo: inativo até iniciar um pedido';
  if (current) {
    text = m.cupPresent === true ? 'Copo detectado'
        : m.cupPresent === false ? 'Copo não detectado. A máquina continua verificando.' : 'Procurando o copo…';
  }
  cup.className = `m-cup${current && m.cupPresent === false ? ' bad' : ''}`;
  cup.textContent = text;
}

function renderOrders() {
  $('orders').innerHTML = state.orders.length ? state.orders.map((o) => {
    const canCancel = ACTIVE.includes(o.status);
    return `
    <li>
      <span>#${esc(o.id)} ${esc(o.drink?.name ?? 'Bebida desconhecida')}</span>
      <span class="order-status-wrap">
        <span class="tag s-${String(o.status).toLowerCase()}">${STATUS[o.status] ?? esc(o.status)}</span>
        ${canCancel ? `<button type="button" class="order-cancel" data-id="${o.id}" title="Cancelar pedido #${esc(o.id)}" aria-label="Cancelar pedido #${esc(o.id)}">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
        </button>` : ''}
      </span>
      <time>${toDate(o.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
    </li>`;
  }).join('') : '<li>Nenhum pedido ainda.</li>';
}

// Cancelar pedido pela lixeirinha
$('orders').addEventListener('click', async (e) => {
  const btn = e.target.closest('.order-cancel');
  if (!btn || btn.disabled) return;

  const id = Number(btn.dataset.id);
  const ok = await showConfirm({
    title: `Cancelar pedido #${id}?`,
    message: 'Se o drink já estiver sendo preparado, as bombas serão interrompidas.',
    confirmText: 'Cancelar pedido',
  });
  if (!ok) return;

  btn.disabled = true;
  try {
    if (mock) {
      mock.cancel(id);
    } else {
      const updated = await http(API.cancelOrder(id), { method: 'PATCH' });
      onOrder(updated);
    }
    toast(`Pedido #${id} cancelado.`);
  } catch (err) {
    btn.disabled = false;
    toast(err.message || 'Não foi possível cancelar o pedido.');
  }
});

const render = () => {
  renderDrinks();
  renderOrderBar();
  renderMachine();
  renderOrders();
};

/* ---------- state updates ---------- */

const setOrders = (list) => { state.orders = list.sort((a, b) => b.id - a.id).slice(0, 10); };
const upsertOrder = (o) => setOrders([o, ...state.orders.filter((x) => x.id !== o.id)]);

function onOrder(o) {
  const m = state.machine;
  upsertOrder(o);

  if (o.status === 'IN_PREPARATION' || o.status === 'PREPARING') {
    m.orderId = o.id;
    m.progress = 0;
  } else if (!ACTIVE.includes(o.status) && Number(o.id) === Number(m.orderId)) {
    m.progress = o.status === 'COMPLETED' ? 100 : 0;
    m.cupPresent = null;
    if (o.status !== 'COMPLETED') m.orderId = null;
    setTimeout(() => { if (!busy()) { m.progress = 0; renderMachine(); } }, 2000);
  }

  loadDrinks();
  render();
}

function onMachine(msg) {
  const m = state.machine;
  let changed = false;

  if (msg.status === 'ONLINE' || msg.status === 'OFFLINE') {
    const isOnline = msg.status === 'ONLINE';
    changed = m.connected !== isOnline;
    m.connected = isOnline;
    if (!isOnline) {
      m.cupPresent = null;
      m.progress = 0;
      state.cart = {};
    }
  }

  if (msg.estado) {
    if (!m.connected) { m.connected = true; changed = true; }

    const targetId = msg.pedidoId ?? m.orderId;
    const targetOrder = state.orders.find((o) => Number(o.id) === Number(targetId));

    // Se o pedido já foi cancelado, ignora qualquer evento atrasado do ESP32 pra ele
    if (targetOrder && (targetOrder.status === 'CANCELLED' || targetOrder.status === 'CANCELED')) {
      if (changed) render();
      return;
    }

    if (msg.pedidoId) m.orderId = msg.pedidoId;

    switch (msg.estado) {
      case 'PROCURANDO':
        m.cupPresent = null;
        m.progress = 15;
        break;
      case 'ENCHENDO':
        m.cupPresent = true;
        m.progress = 65;
        break;
      case 'ERRO_COPOS':
        m.cupPresent = false;
        toast(`Faltam ${(msg.pedidos || 1) - (msg.atendidos || 0)} copo(s)!`);
        break;
      case 'CONCLUIDO': {
        m.cupPresent = null;
        m.progress = 100;
        if (targetOrder && ACTIVE.includes(targetOrder.status)) {
          upsertOrder({ ...targetOrder, status: 'COMPLETED' });
          changed = true;
        }
        setTimeout(() => { if (!busy()) { m.progress = 0; renderMachine(); } }, 2000);
        break;
      }
    }
  }

  changed ? render() : renderMachine();
}

async function loadDrinks() {
  if (MOCK) return;
  state.drinks = await http(API.drinks);
  state.loaded = true;
  reconcileCart();
  render();
}

async function loadOrders() {
  if (MOCK) return;
  setOrders(await http(API.orders));
  render();
}

const refresh = () => Promise.all([loadDrinks(), loadOrders()])
    .catch(() => toast('Não foi possível conectar ao servidor.'));

function connectStomp() {
  const client = new StompJs.Client({
    webSocketFactory: () => new SockJS(API.socket),
    reconnectDelay: 3000,
    onConnect: () => {
      client.subscribe(API.topicOrders, (frame) => onOrder(JSON.parse(frame.body)));
      client.subscribe(API.topicMachine, (frame) => onMachine(JSON.parse(frame.body)));
      refresh();
    },
    onWebSocketClose: () => {
      state.machine.connected = false;
      state.cart = {};
      render();
    },
  });
  client.activate();
}

/* ---------- mock mode (?mock=1) ---------- */

function startMock() {
  const stock = (id, name, ml) => ({ id, name, currentQuantityMl: ml });
  const lime = stock(1, 'Limão', 120);   // propositalmente baixo pra testar desconto ao vivo
  const passion = stock(2, 'Maracujá', 700);
  const soda = stock(3, 'Água com gás', 1500);
  const mint = stock(4, 'Hortelã', 80);
  const use = (ingredient, quantityMl) => ({ ingredient, quantityMl });

  state.drinks = [
    { id: 1, name: 'Suco de limão', recipes: [use(lime, 60), use(soda, 140)] },
    { id: 2, name: 'Maracujá', recipes: [use(passion, 80), use(soda, 120)] },
    { id: 3, name: 'Mojito sem álcool', recipes: [use(lime, 60), use(mint, 20), use(soda, 140)] },
    { id: 4, name: 'Refresco de hortelã', recipes: [use(mint, 90)] }, // sem estoque
  ];

  let nextId = 0;
  const queue = [];
  let currentOrderId = null;
  let activeTimers = [];

  const clearMockTimers = () => {
    activeTimers.forEach(clearTimeout);
    activeTimers = [];
  };

  setTimeout(() => onMachine({ status: 'ONLINE' }), 300);

  function processNext() {
    if (currentOrderId !== null || !queue.length) return;
    const order = queue.shift();
    currentOrderId = order.id;
    onOrder({ ...order, status: 'IN_PREPARATION' });

    activeTimers.push(setTimeout(() => {
      if (currentOrderId !== order.id) return;
      onMachine({ estado: 'PROCURANDO', pedidoId: order.id });
    }, 500));

    activeTimers.push(setTimeout(() => {
      if (currentOrderId !== order.id) return;
      onMachine({ estado: 'ENCHENDO', pedidoId: order.id });
    }, 1500));

    activeTimers.push(setTimeout(() => {
      if (currentOrderId !== order.id) return;
      onMachine({ estado: 'CONCLUIDO', pedidoId: order.id });
      onOrder({ ...order, status: 'COMPLETED' });
      currentOrderId = null;
      clearMockTimers();
      setTimeout(processNext, 700);
    }, 3000));
  }

  return {
    enqueue(drinkIds) {
      for (const drinkId of drinkIds) {
        const drink = state.drinks.find((d) => d.id === drinkId);
        drink.recipes.forEach((r) => { r.ingredient.currentQuantityMl -= recipeQty(r); });
        const order = { id: ++nextId, drink, dateTime: new Date().toISOString(), status: 'PENDING' };
        queue.push(order);
        upsertOrder(order);
      }
      render();
      setTimeout(processNext, 300);
    },
    cancel(orderId) {
      const idx = queue.findIndex((o) => o.id === orderId);
      if (idx !== -1) queue.splice(idx, 1);

      const order = state.orders.find((o) => o.id === orderId);
      if (order) {
        if (ACTIVE.includes(order.status)) {
          order.drink?.recipes?.forEach((r) => { r.ingredient.currentQuantityMl += recipeQty(r); });
        }
        onOrder({ ...order, status: 'CANCELLED' });
      }

      // Aborta os timers do pedido que estava em preparo e chama o próximo da fila
      if (currentOrderId === orderId) {
        clearMockTimers();
        currentOrderId = null;
        setTimeout(processNext, 400);
      }
    },
  };
}

/* ---------- interactions & boot ---------- */

const mock = MOCK ? startMock() : null;

// Cliques nos botões − e + de cada card
$('drinks').addEventListener('click', (e) => {
  const btn = e.target.closest('.step-btn');
  if (!btn || btn.disabled) return;

  const id = Number(btn.dataset.id);
  const action = btn.dataset.action;
  const current = state.cart[id] || 0;

  if (action === 'inc') {
    if (totalSelected() >= MAX_ORDER) return;
    const drink = state.drinks.find((d) => d.id === id);
    if (!drink || extraServings(drink, remainingStock()) < 1) return;
    state.cart[id] = current + 1;
  } else if (action === 'dec' && current > 0) {
    if (current === 1) delete state.cart[id];
    else state.cart[id] = current - 1;
  }

  renderDrinks();
  renderOrderBar();
});

// Limpar seleção
$('clear-order').addEventListener('click', () => {
  state.cart = {};
  renderDrinks();
  renderOrderBar();
});

// Enviar lote (1 a 3 pedidos PENDING para o backend / ESP32)
$('submit-order').addEventListener('click', async () => {
  if (globalBlock() || totalSelected() === 0) return;

  const drinkIds = [];
  for (const [idStr, qty] of Object.entries(state.cart)) {
    for (let i = 0; i < qty; i++) drinkIds.push(Number(idStr));
  }

  state.sending = true;
  render();

  try {
    if (mock) {
      state.cart = {};
      mock.enqueue(drinkIds);
      toast(`${drinkIds.length} ${drinkIds.length === 1 ? 'bebida enviada' : 'bebidas enviadas'} para a fila!`);
    } else {
      let sent = 0;
      for (const drinkId of drinkIds) {
        const created = await http(API.orders, {
          method: 'POST',
          body: JSON.stringify({ drinkId, copos: 1 }),
        });
        upsertOrder(created);
        sent++;
      }
      state.cart = {};
      toast(`${sent} ${sent === 1 ? 'bebida enviada' : 'bebidas enviadas'} para a fila!`);
      await refresh();
    }
  } catch (err) {
    toast(err.message || 'Não foi possível enviar o pedido.');
    await refresh();
  } finally {
    state.sending = false;
    render();
  }
});

render();
if (!MOCK) {
  refresh();
  setInterval(refresh, 10000);
  connectStomp();
}


/* Messages modal*/

function showConfirm({
                       title = 'Confirmar ação',
                       message = 'Tem certeza que deseja continuar?',
                       confirmText = 'Excluir',
                       cancelText = 'Voltar',
                     } = {}) {
  return new Promise((resolve) => {
    let backdrop = document.getElementById('cmodal-backdrop');

    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'cmodal-backdrop';
      backdrop.className = 'cmodal-backdrop';
      backdrop.innerHTML = `
        <div class="cmodal-card" role="dialog" aria-modal="true" aria-labelledby="cmodal-title">
          <div class="cmodal-header">
            <div class="cmodal-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
              </svg>
            </div>
            <h3 class="cmodal-title" id="cmodal-title"></h3>
          </div>
          <p class="cmodal-msg" id="cmodal-msg"></p>
          <div class="cmodal-actions">
            <button type="button" class="cmodal-btn cmodal-btn-cancel" id="cmodal-cancel"></button>
            <button type="button" class="cmodal-btn cmodal-btn-danger" id="cmodal-ok"></button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);
    }

    const titleEl  = backdrop.querySelector('#cmodal-title');
    const msgEl    = backdrop.querySelector('#cmodal-msg');
    const cancelEl = backdrop.querySelector('#cmodal-cancel');
    const okEl     = backdrop.querySelector('#cmodal-ok');

    titleEl.textContent  = title;
    msgEl.textContent    = message;
    cancelEl.textContent = cancelText;
    okEl.textContent     = confirmText;

    const close = (result) => {
      backdrop.classList.remove('is-open');
      document.removeEventListener('keydown', onKey);
      backdrop.onclick = null;
      cancelEl.onclick = null;
      okEl.onclick = null;
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };

    backdrop.onclick = (e) => { if (e.target === backdrop) close(false); };
    cancelEl.onclick = () => close(false);
    okEl.onclick     = () => close(true);
    document.addEventListener('keydown', onKey);

    requestAnimationFrame(() => {
      backdrop.classList.add('is-open');
      cancelEl.focus();
    });
  });
}