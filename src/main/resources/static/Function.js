// ============================================================================
// Function.js - Operation screen logic. Loaded by templates/Operation.html.
// ============================================================================

const MOCK = new URLSearchParams(location.search).has('mock');
const REQUIRE_MACHINE = true;

const API = {
  drinks: '/api/drinks',
  orders: '/api/orders',
  socket: '/ws-mocktails',
  topicOrders: '/topic/orders',
  topicMachine: '/topic/machine',
};

const STATUS = { PENDING: 'Na fila', IN_PREPARATION: 'Em preparo', COMPLETED: 'Concluído', ERROR: 'Erro', CANCELLED: 'Cancelado' };
const ACTIVE = ['PENDING', 'IN_PREPARATION'];
const MAX_GAUGE = 20;
const GLASS_H = 143;

const state = {
  drinks: [],
  orders: [],
  loaded: MOCK,
  sending: false,
  machine: { connected: false, cupPresent: null, progress: 0, orderId: null },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tint = (name) => `hsl(${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 52%)`;
const busy = () => state.orders.some((o) => ACTIVE.includes(o.status));

const servings = (d) => (d.recipes?.length
    ? Math.min(...d.recipes.map((r) => Math.floor(r.ingredient.currentQuantityMl / r.quantityMl)))
    : 0);

const toDate = (v) => (Array.isArray(v) ? new Date(v[0], v[1] - 1, v[2], v[3] ?? 0, v[4] ?? 0, v[5] ?? 0) : new Date(v));

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
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 4000);
}

function blockReason(d) {
  const m = state.machine;
  if (servings(d) < 1) return 'Sem estoque';
  if (REQUIRE_MACHINE && !m.connected) return 'Máquina offline';
  if (busy() || state.sending) return 'Máquina ocupada';
  return null;
}

function renderDrinks() {
  const container = $('drinks');
  if (!container) return;
  const list = state.drinks.filter((d) => d.active !== false);
  if (!list.length) {
    container.innerHTML = `<p class="empty-msg">${state.loaded ? 'Nenhuma bebida no cardápio. Cadastre uma em Gerenciamento.' : 'Carregando cardápio…'}</p>`;
    return;
  }
  container.innerHTML = list.map((d) => {
    const n = servings(d);
    const why = blockReason(d);
    const pct = Math.min(n, MAX_GAUGE) / MAX_GAUGE * 100;
    return `<article class="drink${n < 1 ? ' empty' : ''}" style="--c:${tint(d.name)};--lvl:${pct}%">
      <span class="gauge"><i></i></span>
      <div class="body">
        <h3>${esc(d.name)}</h3>
        <p class="stock">${n < 1 ? 'Insumos insuficientes' : `Dá para ${n} ${n === 1 ? 'bebida' : 'bebidas'}`}</p>
        <button class="prepare" data-id="${d.id}" ${why ? 'disabled' : ''}>${why ?? 'Preparar bebida'}</button>
      </div>
    </article>`;
  }).join('');
}

function renderMachine() {
  const m = state.machine;
  const current = state.orders.find((o) => ACTIVE.includes(o.status));

  const connEl = $('conn');
  if (connEl) {
    connEl.className = `pill ${m.connected ? 'on' : ''}`;
    connEl.textContent = m.connected ? 'Máquina online' : 'Máquina offline';
  }

  const glassEl = $('glass');
  if (glassEl) {
    if (current?.drink) glassEl.style.setProperty('--liquid', tint(current.drink.name));
    glassEl.setAttribute('aria-valuenow', Math.round(m.progress));
  }

  const liquidEl = $('liquid');
  if (liquidEl) {
    liquidEl.style.transform = `translateY(${GLASS_H * (1 - m.progress / 100)}px)`;
  }

  const pctEl = $('m-pct');
  if (pctEl) pctEl.textContent = `${Math.round(m.progress)}%`;

  const stateEl = $('m-state');
  if (stateEl) stateEl.textContent = !m.connected ? 'Máquina offline' : current ? `Preparando ${current.drink?.name ?? 'bebida'}` : 'Pronta';

  const cup = $('m-cup');
  if (cup) {
    let text = 'Sensor de copo: inativo até iniciar um pedido';
    if (current) {
      text = m.cupPresent === true ? 'Copo detectado'
          : m.cupPresent === false ? 'Copo não detectado. A máquina continua verificando.' : 'Procurando o copo…';
    }
    cup.className = `m-cup${current && m.cupPresent === false ? ' bad' : ''}`;
    cup.textContent = text;
  }
}

function renderOrders() {
  const ordersEl = $('orders');
  if (!ordersEl) return;
  ordersEl.innerHTML = state.orders.length ? state.orders.map((o) => `
    <li>
      <span>#${esc(o.id)} ${esc(o.drink?.name ?? 'Bebida desconhecida')}</span>
      <span class="tag s-${String(o.status).toLowerCase()}">${STATUS[o.status] ?? esc(o.status)}</span>
      <time>${toDate(o.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
    </li>`).join('') : '<li>Nenhum pedido ainda.</li>';
}

const render = () => { renderDrinks(); renderMachine(); renderOrders(); };

const setOrders = (list) => {
  state.orders = list.sort((a, b) => b.id - a.id).slice(0, 10);
};
const upsertOrder = (o) => setOrders([o, ...state.orders.filter((x) => x.id !== o.id)]);

function onOrder(o) {
  const m = state.machine;
  upsertOrder(o);
  if (o.status === 'IN_PREPARATION') { m.orderId = o.id; m.progress = 0; }
  else if (!ACTIVE.includes(o.status) && o.id === m.orderId) {
    m.progress = o.status === 'COMPLETED' ? 100 : 0;
    setTimeout(() => { if (!busy()) { m.progress = 0; renderMachine(); } }, 2000);
  }
  loadDrinks();
  render();
}

function onMachine(msg) {
  const m = state.machine;
  const cup = msg.cupPresent ?? null;
  const changed = m.connected !== !!msg.connected;
  m.connected = !!msg.connected;
  m.cupPresent = cup;
  if (msg.progress != null) { m.progress = msg.progress; m.orderId = msg.orderId ?? m.orderId; }
  changed ? render() : renderMachine();
}

async function loadDrinks() {
  if (MOCK) return;
  state.drinks = await http(API.drinks);
  state.loaded = true;
  render();
}

async function loadOrders() {
  if (MOCK) return;
  setOrders(await http(API.orders));
  render();
}

const refresh = () => Promise.all([loadDrinks(), loadOrders()]).catch(() => toast('Não foi possível conectar ao servidor.'));

function connectStomp() {
  const client = new StompJs.Client({
    webSocketFactory: () => new SockJS(API.socket),
    reconnectDelay: 3000,
    onConnect: () => {
      client.subscribe(API.topicOrders, (frame) => onOrder(JSON.parse(frame.body)));
      client.subscribe(API.topicMachine, (frame) => onMachine(JSON.parse(frame.body)));
      refresh();
    },
    onWebSocketClose: () => { state.machine.connected = false; render(); },
  });
  client.activate();
}

function startMock() {
  const stock = (ml) => ({ currentQuantityMl: ml });
  const lime = stock(900), passion = stock(700), soda = stock(1500), mint = stock(80);
  const use = (ingredient, quantityMl) => ({ ingredient, quantityMl });
  state.drinks = [
    { id: 1, name: 'Suco de limão', recipes: [use(lime, 60), use(soda, 140)] },
    { id: 2, name: 'Maracujá', recipes: [use(passion, 80), use(soda, 120)] },
    { id: 3, name: 'Mojito sem álcool', recipes: [use(lime, 40), use(mint, 20), use(soda, 140)] },
    { id: 4, name: 'Refresco de hortelã', recipes: [use(mint, 90)] },
  ];
  let nextId = 0;
  setTimeout(() => onMachine({ connected: true, cupPresent: null }), 300);
  return {
    order(drinkId) {
      const drink = state.drinks.find((d) => d.id === drinkId);
      drink.recipes.forEach((r) => { r.ingredient.currentQuantityMl -= r.quantityMl; });
      const order = { id: ++nextId, drink, dateTime: new Date().toISOString(), status: 'IN_PREPARATION' };
      onOrder(order);
      let progress = 0;
      const timer = setInterval(() => {
        progress += 4;
        if (progress < 100) return onMachine({ connected: true, cupPresent: progress > 20, progress, orderId: order.id });
        clearInterval(timer);
        onOrder({ ...order, status: 'COMPLETED' });
      }, 150);
    },
  };
}

const mock = MOCK ? startMock() : null;

const drinksContainer = $('drinks');
if (drinksContainer) {
  drinksContainer.addEventListener('click', async (e) => {
    const btn = e.target.closest('.prepare');
    if (!btn || btn.disabled) return;
    const drinkId = Number(btn.dataset.id);

    // Supondo um preço fixo de R$ 10,00 por drink para o teste de créditos
    const precoDrink = 10.00;
    if (saldoGlobal < precoDrink) {
      alert(`Saldo insuficiente! O drink custa R$ ${precoDrink.toFixed(2)} e você tem R$ ${saldoGlobal.toFixed(2)}.`);
      return;
    }

    // Desconta o crédito ao pedir
    saldoGlobal -= precoDrink;
    atualizarSaldoTela();

    state.sending = true;
    render();
    try {
      if (mock) mock.order(drinkId);
      else onOrder(await http(API.orders, { method: 'POST', body: JSON.stringify({ drinkId }) }));
    } catch (err) {
      toast(err.message || 'Não foi possível iniciar a bebida.');
      // Devolve o saldo caso dê erro na API
      saldoGlobal += precoDrink;
      atualizarSaldoTela();
    } finally {
      state.sending = false;
      render();
    }
  });
}

render();
if (!MOCK) {
  refresh();
  setInterval(refresh, 10000);
  connectStomp();
}

// ============================================================================
// Lógica de Crédito e Pagamento Fake
// ============================================================================
let saldoGlobal = 0.00;
let valorPendente = 0.00;

function atualizarSaldoTela() {
  const el = document.getElementById('saldo-atual');
  if (el) el.innerText = saldoGlobal.toFixed(2);
}

function abrirModalPagamento() {
  const modal = document.getElementById('modal-pagamento');
  if (modal) {
    document.getElementById('etapa-selecao').style.display = 'block';
    document.getElementById('etapa-processando').style.display = 'none';
    document.getElementById('etapa-sucesso').style.display = 'none';
    document.getElementById('input-valor').value = '';
    modal.style.display = 'flex';
  } else {
    console.error("Modal de pagamento não encontrado no HTML!");
  }
}

function fecharModalPagamento() {
  const modal = document.getElementById('modal-pagamento');
  if (modal) modal.style.display = 'none';
}

function iniciarPagamento(metodo) {
  const inputValor = document.getElementById('input-valor');
  valorPendente = parseFloat(inputValor.value);

  if (isNaN(valorPendente) || valorPendente <= 0) {
    alert("Por favor, digite um valor válido!");
    return;
  }

  document.getElementById('etapa-selecao').style.display = 'none';
  document.getElementById('etapa-processando').style.display = 'block';

  if (metodo === 'PIX') {
    document.getElementById('visao-pix').style.display = 'block';
    document.getElementById('visao-cartao').style.display = 'none';

    const payloadFake = `00020126360014BR.GOV.BCB.PIX0114+5512999999999520400005303986540${valorPendente.toFixed(2)}`;
    const qrImg = document.getElementById('img-qrcode');
    if (qrImg) {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payloadFake)}`;
    }
  } else if (metodo === 'CARTAO') {
    document.getElementById('visao-pix').style.display = 'none';
    document.getElementById('visao-cartao').style.display = 'block';
  }

  setTimeout(() => {
    finalizarPagamentoSucesso();
  }, 3500);
}

function finalizarPagamentoSucesso() {
  saldoGlobal += valorPendente;
  atualizarSaldoTela();

  document.getElementById('etapa-processando').style.display = 'none';
  document.getElementById('etapa-sucesso').style.display = 'block';
  const confEl = document.getElementById('valor-confirmado');
  if (confEl) confEl.innerText = valorPendente.toFixed(2);

  setTimeout(() => {
    fecharModalPagamento();
  }, 2000);
}