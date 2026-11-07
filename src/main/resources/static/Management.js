// Management screen logic. Loaded by templates/Management.html.
// Add ?mock=1 to the URL to run the screen without the back end.
const MOCK = new URLSearchParams(location.search).has('mock');

const API = {
  ingredients: '/api/ingredients', // GET | POST { name, currentQuantityMl, maxCapacityMl, pumpPin } | PATCH /{id}/stock { currentQuantityMl }
  drinks: '/api/drinks',           // GET ?all=true* | POST | PUT /{id}* | PATCH /{id}/status?active= | DELETE /{id}
  orders: '/api/orders',           // GET (all orders, with drink and recipes)
};                                 // * needs a small back end change (see the notes delivered with this screen)
const STATUS = { PENDING: 'Na fila', IN_PREPARATION: 'Em preparo', COMPLETED: 'Concluído', ERROR: 'Erro', CANCELLED: 'Cancelado' };
const DAY = 86400000;

const state = { ingredients: [], drinks: [], orders: [], editingId: null, sig: '' };
const charts = {};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tint = (name) => `hsl(${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 52%)`; // same color as the Operation screen
const num = (v) => Number(v) || 0;
const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); // ignores case and accents
// Volumes are stored in ml by the API, but shown to the user in liters when they are 1 L or more.
const fmtVolume = (ml) => (ml >= 1000 ? `${(ml / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L` : `${Math.round(ml)} ml`);
const toDate = (v) => (Array.isArray(v) ? new Date(v[0], v[1] - 1, v[2], v[3] ?? 0, v[4] ?? 0, v[5] ?? 0) : new Date(v));
const dosingMs = (o) => (o.drink?.recipes ?? []).reduce((sum, r) => sum + num(r.dosageTimeMs), 0); // sum of pump times in the recipe

async function http(url, method = 'GET', body) {
  if (MOCK) return mockApi(url, method, body);
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Falha na requisição (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 4500);
}

/* ---------- rendering ---------- */

// 2.1 Reservoir levels: bars from 0% to 100%.
function renderLevels() {
  $('levels').innerHTML = state.ingredients.map((i) => {
    const pct = Math.max(0, Math.min(100, num(i.currentQuantityMl) / (num(i.maxCapacityMl) || 1) * 100));
    const tone = pct < 20 ? 'low' : pct < 50 ? 'mid' : 'ok';
    return `<div class="level">
      <div class="level-head"><span>${esc(i.name)}</span><span>${fmtVolume(num(i.currentQuantityMl))} / ${fmtVolume(num(i.maxCapacityMl))} · ${Math.round(pct)}%</span></div>
      <div class="bar ${tone}" role="progressbar" aria-label="Nível de ${esc(i.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join('') || '<p class="muted">Nenhum reservatório cadastrado.</p>';
}

// Selects and recipe rows depend only on the list of ingredients, so they are rebuilt only when it changes.
function renderIngredientInputs() {
  const sig = state.ingredients.map((i) => i.id).join();
  if (sig === state.sig) return;
  state.sig = sig;
  const select = $('rs-ingredient');
  const previous = select.value;
  select.innerHTML = state.ingredients.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('')
    + '<option value="new">+ Novo produto…</option>';
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  fillRecipeRows();
}

function fillRecipeRows(recipes = []) {
  const byId = Object.fromEntries(recipes.map((r) => [r.ingredient?.id, r]));
  $('recipe-rows').innerHTML = state.ingredients.map((i) => `<tr>
    <td>${esc(i.name)}</td>
    <td><input type="number" min="0" step="1" data-ing="${i.id}" data-f="ml" aria-label="${esc(i.name)}: quantidade (ml)" value="${byId[i.id] ? num(byId[i.id].quantityMl) : ''}"></td>
    <td><input type="number" min="0" step="1" data-ing="${i.id}" data-f="ms" aria-label="${esc(i.name)}: tempo da bomba (ms)" value="${byId[i.id] ? num(byId[i.id].dosageTimeMs) : ''}"></td>
  </tr>`).join('');
}

function draw(id, config) {
  const canvas = $(`chart-${id}`);
  if (!canvas) return; // already replaced by the fallback message below
  if (typeof Chart === 'undefined') { // the Chart.js script (CDN) did not load: keep the rest of the screen working
    canvas.parentElement.innerHTML = '<p class="muted">Os gráficos estão indisponíveis porque o Chart.js não foi carregado.</p>';
    return;
  }
  charts[id]?.destroy();
  charts[id] = new Chart($(`chart-${id}`), { ...config, options: { responsive: true, maintainAspectRatio: false, animation: false, ...config.options } });
}

// 2.3 Reports: cups served (day, week, month), best sellers and ingredient consumption. Only completed orders count.
function renderReports() {
  const done = state.orders.filter((o) => o.status === 'COMPLETED').map((o) => ({ ...o, at: toDate(o.dateTime) }));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  $('kpi-day').textContent = done.filter((o) => o.at >= today).length;
  $('kpi-week').textContent = done.filter((o) => Date.now() - o.at <= 7 * DAY).length;
  $('kpi-month').textContent = done.filter((o) => Date.now() - o.at <= 30 * DAY).length;

  const counts = {};
  done.forEach((o) => { const n = o.drink?.name ?? 'Desconhecida'; counts[n] = (counts[n] ?? 0) + 1; });
  const rank = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  draw('rank', {
    type: 'bar',
    data: { labels: rank.map((r) => r[0]), datasets: [{ label: 'Copos servidos', data: rank.map((r) => r[1]), backgroundColor: rank.map((r) => tint(r[0])) }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  });

  // Consumption: ml per ingredient per day (last 14 days), from the recipe of each completed order.
  const days = Array.from({ length: 14 }, (_, k) => { const d = new Date(today); d.setDate(d.getDate() - 13 + k); return d; });
  const use = {};
  done.forEach((o) => {
    const idx = days.findIndex((d) => d.toDateString() === o.at.toDateString());
    if (idx < 0) return;
    (o.drink?.recipes ?? []).forEach((r) => {
      const name = r.ingredient?.name;
      if (name) (use[name] ??= Array(14).fill(0))[idx] += num(r.quantityMl);
    });
  });
  draw('use', {
    type: 'line',
    data: {
      labels: days.map((d) => `${d.getDate()}/${d.getMonth() + 1}`),
      datasets: Object.entries(use).map(([n, v]) => ({ label: n, data: v, borderColor: tint(n), backgroundColor: tint(n), tension: 0.3 })),
    },
    options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'ml' } } }, plugins: { legend: { position: 'bottom' } } },
  });
}

// 2.4 Menu list with edit, show/hide and delete.
function renderMenu() {
  $('menu').innerHTML = state.drinks.length ? state.drinks.map((d) => {
    const off = d.active === false;
    const recipe = (d.recipes ?? []).map((r) => `${esc(r.ingredient?.name ?? '?')} ${num(r.quantityMl)} ml, ${num(r.dosageTimeMs)} ms`).join(' | ');
    return `<li class="drink-row${off ? ' off' : ''}">
      <div><strong>${esc(d.name)}</strong> <span class="badge ${off ? 'off' : 'on'}">${off ? 'Oculta' : 'No cardápio'}</span><div class="muted">${recipe}</div></div>
      <div class="actions" data-id="${d.id}">
        <button class="btn ghost" data-act="edit">Editar</button>
        <button class="btn ghost" data-act="toggle">${off ? 'Mostrar no cardápio' : 'Ocultar do cardápio'}</button>
        <button class="btn danger" data-act="delete">Excluir</button>
      </div></li>`;
  }).join('') : '<li class="muted">Nenhuma bebida cadastrada.</li>';
}

// 2.5 Complete history of every order.
function renderHistory() {
  $('history').innerHTML = [...state.orders].sort((a, b) => b.id - a.id).map((o) => `<tr>
    <td>#${esc(o.id)}</td>
    <td>${toDate(o.dateTime).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
    <td>${esc(o.drink?.name ?? 'Bebida desconhecida')}</td>
    <td>${(dosingMs(o) / 1000).toFixed(1).replace('.', ',')} s</td>
    <td><span class="tag s-${String(o.status).toLowerCase()}">${STATUS[o.status] ?? esc(o.status)}</span></td>
  </tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum pedido ainda.</td></tr>';
}

/* ---------- data ---------- */

async function load() {
  try {
    [state.ingredients, state.drinks, state.orders] = await Promise.all([
      http(API.ingredients), http(`${API.drinks}?all=true`), http(API.orders),
    ]);
    renderLevels(); renderIngredientInputs(); updateRestockSummary(); renderMenu(); renderHistory(); renderReports(); // reports last: they depend on Chart.js
  } catch (err) {
    toast('Não foi possível carregar os dados do servidor.');
  }
}

// Runs an action, reloads the data and tells the user what happened.
async function run(action, okMessage) {
  try { await action(); await load(); toast(okMessage); return true; }
  catch (err) { toast(err.message || 'Algo deu errado.'); return false; }
}

/* ---------- events ---------- */

// 2.2 Restock: the user enters how many bottles and the bottle size in liters (e.g. 1 bottle of 2 L).
// The amount is converted to ml, added to the current stock and sent as the new TOTAL, capped at the reservoir capacity.
function restockAmountMl() {
  const size = $('rs-size').value === 'other' ? num($('rs-other').value) : num($('rs-size').value);
  return Math.round(num($('rs-count').value) * size * 1000);
}

// Updates the live line "Total a adicionar ... Espaço livre ..." and shows the custom size field when needed.
function updateRestockSummary() {
  $('rs-other-wrap').hidden = $('rs-size').value !== 'other';
  const isNew = $('rs-ingredient').value === 'new';
  $('rs-new').hidden = !isNew;
  const ing = isNew ? null : state.ingredients.find((i) => i.id === Number($('rs-ingredient').value));
  const max = isNew ? Math.round(num($('rs-capacity').value) * 1000) : num(ing?.maxCapacityMl);
  const free = Math.max(0, max - num(ing?.currentQuantityMl));
  const extra = isNew ? (max ? ` · Capacidade do reservatório: ${fmtVolume(max)}` : '') : (max ? ` · Espaço livre: ${fmtVolume(free)}` : '');
  $('rs-total').textContent = `Total a adicionar: ${fmtVolume(restockAmountMl())}${extra}`;
}
['rs-ingredient', 'rs-count', 'rs-size', 'rs-other', 'rs-capacity'].forEach((id) => $(id).addEventListener('input', updateRestockSummary));

// Registers a new product (a new reservoir) so any kind of liquid can be used, then fills it with the first bottles.
// Done deliberately through the "+ Novo produto…" option, so a typo in a name never creates a product by accident.
async function createProduct(addedMl) {
  const name = $('rs-name').value.trim();
  const capacityMl = Math.round(num($('rs-capacity').value) * 1000);
  const pinText = $('rs-pin').value.trim();
  const pin = Number(pinText);
  if (!name) return toast('Digite o nome do produto.');
  if (state.ingredients.some((i) => norm(i.name) === norm(name))) return toast('Já existe um produto com esse nome. Escolha-o na lista de reservatórios.');
  if (capacityMl <= 0) return toast('Informe a capacidade do reservatório em litros.');
  if (pinText === '' || !Number.isInteger(pin) || pin < 0) return toast('Informe o pino da bomba (um número inteiro).');
  const used = state.ingredients.find((i) => i.pumpPin === pin);
  if (used) return toast(`O pino ${pin} já é usado por ${used.name}. Escolha outro pino.`);
  const filled = Math.min(addedMl, capacityMl);
  const msg = filled < addedMl
    ? `${name} cadastrado e cheio (${fmtVolume(capacityMl)}). O excedente de ${fmtVolume(addedMl - filled)} não foi adicionado.`
    : `${name} cadastrado com ${fmtVolume(filled)}.`;
  const body = { name, currentQuantityMl: filled, maxCapacityMl: capacityMl, pumpPin: pin };
  if (await run(() => http(API.ingredients, 'POST', body), msg)) {
    const created = state.ingredients.find((i) => norm(i.name) === norm(name));
    if (created) $('rs-ingredient').value = String(created.id); // next restocks go to the new product
    ['rs-name', 'rs-capacity', 'rs-pin'].forEach((id) => { $(id).value = ''; });
    $('rs-count').value = 1;
    updateRestockSummary();
  }
}

$('restock').addEventListener('submit', async (e) => {
  e.preventDefault();
  const added = restockAmountMl();
  if (added <= 0) return toast('Informe a quantidade de garrafas e o tamanho da garrafa.');
  if ($('rs-ingredient').value === 'new') return createProduct(added);
  const ing = state.ingredients.find((i) => i.id === Number($('rs-ingredient').value));
  if (!ing) return toast('Escolha um reservatório.');
  const max = num(ing.maxCapacityMl);
  const total = num(ing.currentQuantityMl) + added;
  const next = max ? Math.min(total, max) : total;
  const msg = next < total
    ? `${ing.name} está cheio (${fmtVolume(max)}). O excedente de ${fmtVolume(total - next)} não foi adicionado.`
    : `${ing.name}: +${fmtVolume(added)}. Agora tem ${fmtVolume(next)}.`;
  if (await run(() => http(`${API.ingredients}/${ing.id}/stock`, 'PATCH', { currentQuantityMl: next }), msg)) {
    $('rs-count').value = 1; // keep the bottle size, reset the count
    updateRestockSummary();
  }
});

function resetDrinkForm() {
  state.editingId = null;
  $('d-name').value = '';
  fillRecipeRows();
  $('drink-form-title').textContent = 'Nova bebida';
  $('d-submit').textContent = 'Cadastrar bebida';
  $('d-cancel').hidden = true;
}

$('d-cancel').addEventListener('click', resetDrinkForm);

// 2.4 Create or edit a drink: name plus quantity and pump time for each ingredient used.
$('drink-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const field = (id, f) => num(document.querySelector(`[data-ing="${id}"][data-f="${f}"]`).value);
  const name = $('d-name').value.trim();
  const recipes = state.ingredients
    .map((i) => ({ ingredientId: i.id, quantityMl: field(i.id, 'ml'), dosageTimeMs: field(i.id, 'ms') }))
    .filter((r) => r.quantityMl > 0);
  if (!name) return toast('Dê um nome à bebida.');
  if (!recipes.length) return toast('Informe a quantidade de pelo menos um insumo.');
  if (recipes.some((r) => r.dosageTimeMs <= 0)) return toast('Todo insumo usado precisa de um tempo de bomba em ms.');
  const editing = state.drinks.find((d) => d.id === state.editingId);
  const body = { name, active: editing ? editing.active !== false : true, recipes };
  const ok = await run(
    () => (editing ? http(`${API.drinks}/${editing.id}`, 'PUT', body) : http(API.drinks, 'POST', body)),
    editing ? 'Bebida atualizada.' : 'Bebida cadastrada.',
  );
  if (ok) resetDrinkForm();
});

$('menu').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = Number(btn.closest('.actions').dataset.id);
  const drink = state.drinks.find((d) => d.id === id);
  if (btn.dataset.act === 'edit') {
    state.editingId = id;
    $('d-name').value = drink.name;
    fillRecipeRows(drink.recipes ?? []);
    $('drink-form-title').textContent = `Editar ${drink.name}`;
    $('d-submit').textContent = 'Salvar alterações';
    $('d-cancel').hidden = false;
    $('drink-form').scrollIntoView({ behavior: 'smooth' });
  } else if (btn.dataset.act === 'toggle') {
    const active = drink.active === false; // hidden drinks become active, active ones become hidden
    run(() => http(`${API.drinks}/${id}/status?active=${active}`, 'PATCH'), active ? `A bebida ${drink.name} voltou ao cardápio.` : `A bebida ${drink.name} foi ocultada do cardápio.`);
  } else if (btn.dataset.act === 'delete' && confirm(`Excluir "${drink.name}"? Esta ação não pode ser desfeita.`)) {
    run(() => http(`${API.drinks}/${id}`, 'DELETE'), `A bebida ${drink.name} foi excluída.`);
  }
});

/* ---------- mock mode (?mock=1): in-memory data so the screen works without the back end ---------- */

const mockDb = MOCK ? (() => {
  const ing = (id, name, cur, max) => ({ id, name, currentQuantityMl: cur, maxCapacityMl: max, pumpPin: id });
  const ingredients = [ing(1, 'Suco de limão', 820, 2000), ing(2, 'Maracujá', 310, 2000), ing(3, 'Água com gás', 1650, 3000), ing(4, 'Xarope de hortelã', 90, 1000)];
  const use = (i, quantityMl, dosageTimeMs) => ({ ingredient: ingredients[i], quantityMl, dosageTimeMs });
  const drinks = [
    { id: 1, name: 'Suco de limão', active: true, recipes: [use(0, 60, 3000), use(2, 140, 5000)] },
    { id: 2, name: 'Maracujá', active: true, recipes: [use(1, 80, 3500), use(2, 120, 4500)] },
    { id: 3, name: 'Mojito sem álcool', active: true, recipes: [use(0, 40, 2000), use(3, 20, 1000), use(2, 140, 5000)] },
    { id: 4, name: 'Refresco de hortelã', active: false, recipes: [use(3, 60, 2500), use(2, 150, 5200)] },
  ];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const orders = Array.from({ length: 70 }, (_, i) => ({
    id: i + 1, drink: drinks[Math.floor(rnd() ** 1.6 * 3)],
    dateTime: new Date(Date.now() - ((70 - i) / 70) * 14 * DAY).toISOString(), status: rnd() < 0.06 ? 'ERROR' : 'COMPLETED',
  }));
  return { ingredients, drinks, orders, nextId: 5 };
})() : null;

async function mockApi(url, method, body) {
  const { ingredients, drinks, orders } = mockDb;
  const [path, query = ''] = url.split('?');
  const id = Number(path.split('/')[3]);
  const recipesOf = (list) => list.map((r) => ({ ingredient: ingredients.find((i) => i.id === r.ingredientId), quantityMl: r.quantityMl, dosageTimeMs: r.dosageTimeMs }));
  if (path === API.ingredients && method === 'POST') { const i = { id: Math.max(...ingredients.map((x) => x.id)) + 1, ...body }; ingredients.push(i); return i; }
  if (path === API.ingredients) return ingredients;
  if (path.endsWith('/stock')) { const i = ingredients.find((x) => x.id === id); i.currentQuantityMl = body.currentQuantityMl; return i; }
  if (path === API.orders) return orders;
  if (path === API.drinks && method === 'GET') return drinks;
  if (path === API.drinks) { const d = { id: mockDb.nextId++, name: body.name, active: body.active, recipes: recipesOf(body.recipes) }; drinks.push(d); return d; }
  const d = drinks.find((x) => x.id === id);
  if (method === 'DELETE') { drinks.splice(drinks.indexOf(d), 1); return null; }
  if (path.endsWith('/status')) { d.active = query.includes('active=true'); return null; }
  Object.assign(d, { name: body.name, recipes: recipesOf(body.recipes) }); // PUT
  return d;
}

/* ---------- boot ---------- */

load();
if (!MOCK) setInterval(load, 15000); // keeps levels, reports and history fresh
