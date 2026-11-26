// Management screen logic. Loaded by templates/Management.html.
// Add ?mock=1 to the URL to run the screen without the back end.
const MOCK = new URLSearchParams(location.search).has('mock');

const API = {
    ingredients: '/api/ingredients', // GET | POST | PUT /{id} | PATCH /{id}/stock | DELETE /{id}
    drinks: '/api/drinks',           // GET ?all=true | POST | PUT /{id} | PATCH /{id}/status?active= | DELETE /{id}
    orders: '/api/orders',           // GET
};
const PUMP_PIN = { A: 1, B: 2 };
const PUMP_LABEL = { A: 'Bomba A (esquerda)', B: 'Bomba B (direita)' };
const STATUS = { PENDING: 'Na fila', IN_PREPARATION: 'Em preparo', COMPLETED: 'Concluído', ERROR: 'Erro', CANCELLED: 'Cancelado' };
const DAY = 86400000;

const state = { ingredients: [], drinks: [], orders: [], editingId: null, editingIngId: null, sig: '' };
const charts = {};
let pendingOps = 0;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tint = (name) => `hsl(${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 52%)`;
const num = (v) => Number(v) || 0;
const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const fmtVolume = (ml) => (ml >= 1000 ? `${(ml / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L` : `${Math.round(ml)} ml`);
const toDate = (v) => (Array.isArray(v) ? new Date(v[0], v[1] - 1, v[2], v[3] ?? 0, v[4] ?? 0, v[5] ?? 0) : new Date(v));
const normalizePump = (p) => (String(p || '').toUpperCase() === 'B' ? 'B' : 'A');

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

// Optimistic UI helper: updates screen in 0ms, syncs in background, rolls back on error.
async function optimistic({ apply, request, onSuccess, rollback, okMessage }) {
    pendingOps++;
    apply();
    if (okMessage) toast(okMessage);
    try {
        const res = await request();
        if (onSuccess) onSuccess(res);
        return true;
    } catch (err) {
        rollback();
        toast(err.message || 'Erro no servidor. Alteração desfeita.');
        return false;
    } finally {
        pendingOps--;
    }
}

/* ---------- rendering ---------- */

// 2.1 Reservoir levels: bars from 0% to 100% + edit/delete actions.
function renderLevels() {
    $('levels').innerHTML = state.ingredients.map((i) => {
        const pct = Math.max(0, Math.min(100, num(i.currentQuantityMl) / (num(i.maxCapacityMl) || 1) * 100));
        const tone = pct < 20 ? 'low' : pct < 50 ? 'mid' : 'ok';
        const pump = normalizePump(i.pump ?? (i.pumpPin === 2 ? 'B' : 'A'));
        return `<div class="level">
      <div class="level-head">
        <span>${esc(i.name)} <span class="badge">${esc(PUMP_LABEL[pump])}</span></span>
        <span>${fmtVolume(num(i.currentQuantityMl))} / ${fmtVolume(num(i.maxCapacityMl))} · ${Math.round(pct)}%</span>
      </div>
      <div class="bar ${tone}" role="progressbar" aria-label="Nível de ${esc(i.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>
      <div class="level-actions" data-id="${i.id}">
        <button type="button" class="btn ghost sm" data-action="edit">Editar</button>
        <button type="button" class="btn danger sm" data-action="delete">Excluir</button>
      </div>
    </div>`;
    }).join('') || '<p class="muted">Nenhum reservatório cadastrado.</p>';
}

// Rebuilt whenever an ingredient is added, removed or renamed.
function renderIngredientInputs() {
    const sig = state.ingredients.map((i) => `${i.id}:${i.name}`).join('|');
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
    <td><input type="number" min="1" step="1" data-ing="${i.id}" data-f="ml" aria-label="${esc(i.name)}: quantidade (ml)" value="${byId[i.id] ? num(byId[i.id].QuantityMl ?? byId[i.id].quantityMl) : ''}"></td>
  </tr>`).join('');
}

function draw(id, config) {
    const canvas = $(`chart-${id}`);
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
        canvas.parentElement.innerHTML = '<p class="muted">Os gráficos estão indisponíveis porque o Chart.js não foi carregado.</p>';
        return;
    }
    charts[id]?.destroy();
    charts[id] = new Chart($(`chart-${id}`), { ...config, options: { responsive: true, maintainAspectRatio: false, animation: false, ...config.options } });
}

// 2.3 Reports
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

    const days = Array.from({ length: 14 }, (_, k) => { const d = new Date(today); d.setDate(d.getDate() - 13 + k); return d; });
    const use = {};
    done.forEach((o) => {
        const idx = days.findIndex((d) => d.toDateString() === o.at.toDateString());
        if (idx < 0) return;
        (o.drink?.recipes ?? []).forEach((r) => {
            const name = r.ingredient?.name;
            if (name) (use[name] ??= Array(14).fill(0))[idx] += num(r.QuantityMl ?? r.quantityMl);
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

// 2.4 Menu list
function renderMenu() {
    $('menu').innerHTML = state.drinks.length ? state.drinks.map((d) => {
        const off = d.active === false;
        const recipe = (d.recipes ?? []).map((r) => `${esc(r.ingredient?.name ?? '?')} ${num(r.QuantityMl ?? r.quantityMl)} ml`).join(' | ');
        return `<li class="drink-row${off ? ' off' : ''}">
      <div><strong>${esc(d.name)}</strong> <span class="badge ${off ? 'off' : 'on'}">${off ? 'Oculta' : 'No cardápio'}</span><div class="muted">${recipe}</div></div>
      <div class="actions" data-id="${d.id}">
        <button class="btn ghost" data-act="edit">Editar</button>
        <button class="btn ghost" data-act="toggle">${off ? 'Mostrar no cardápio' : 'Ocultar do cardápio'}</button>
        <button class="btn danger" data-act="delete">Excluir</button>
      </div></li>`;
    }).join('') : '<li class="muted">Nenhuma bebida cadastrada.</li>';
}

// 2.5 Order history
function renderHistory() {
    $('history').innerHTML = [...state.orders].sort((a, b) => b.id - a.id).map((o) => `<tr>
    <td>#${esc(o.id)}</td>
    <td>${toDate(o.dateTime).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
    <td>${esc(o.drink?.name ?? 'Bebida desconhecida')}</td>
    <td><span class="tag s-${String(o.status).toLowerCase()}">${STATUS[o.status] ?? esc(o.status)}</span></td>
  </tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum pedido ainda.</td></tr>';
}

/* ---------- data ---------- */

async function load() {
    try {
        const [ingredients, drinks, orders] = await Promise.all([
            http(API.ingredients), http(`${API.drinks}?all=true`), http(API.orders),
        ]);
        if (pendingOps > 0) return; // don't overwrite an in-flight optimistic update
        state.ingredients = ingredients;
        state.drinks = drinks;
        state.orders = orders;
        renderLevels(); renderIngredientInputs(); updateRestockSummary(); renderMenu(); renderHistory(); renderReports();
    } catch (err) {
        toast('Não foi possível carregar os dados do servidor.');
    }
}

/* ---------- reservoir edit / delete / restock / create ---------- */

function startEditIngredient(ing) {
    state.editingIngId = ing.id;
    $('restock-title').textContent = 'Editar reservatório';
    $('rs-new-legend').textContent = `Editando: ${ing.name}`;
    $('rs-name').value = ing.name;
    $('rs-capacity').value = (num(ing.maxCapacityMl) / 1000) || '';
    $('rs-stock').value = num(ing.currentQuantityMl) / 1000;
    $('rs-pump').value = normalizePump(ing.pump ?? (ing.pumpPin === 2 ? 'B' : 'A'));

    $('rs-select-wrap').hidden = true;
    $('rs-bottles-wrap').hidden = true;
    $('rs-new').hidden = false;
    $('rs-stock-wrap').hidden = false;
    $('rs-submit').textContent = 'Salvar alterações';
    $('rs-cancel').hidden = false;

    $('restock').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('rs-name').focus();
}

function resetRestockForm() {
    state.editingIngId = null;
    $('restock-title').textContent = 'Reabastecimento';
    $('rs-new-legend').textContent = 'Novo produto';
    $('rs-name').value = '';
    $('rs-capacity').value = '';
    $('rs-stock').value = '';
    $('rs-pump').value = 'A';

    $('rs-select-wrap').hidden = false;
    $('rs-bottles-wrap').hidden = false;
    $('rs-stock-wrap').hidden = true;
    $('rs-submit').textContent = 'Atualizar estoque';
    $('rs-cancel').hidden = true;
    updateRestockSummary();
}

$('rs-cancel').addEventListener('click', resetRestockForm);

$('levels').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.closest('[data-id]').getAttribute('data-id'));
    if (id < 0) return toast('Aguarde finalizar o cadastro do reservatório.');
    const ing = state.ingredients.find((i) => Number(i.id) === id);
    if (!ing) return;

    const action = btn.getAttribute('data-action');
    if (action === 'edit') {
        startEditIngredient(ing);
    } else if (action === 'delete' && confirm(`Excluir o reservatório "${ing.name}"? Esta ação não pode ser desfeita.`)) {
        const prevIngredients = [...state.ingredients];
        optimistic({
            okMessage: `Reservatório ${ing.name} excluído.`,
            apply: () => {
                state.ingredients = state.ingredients.filter((i) => Number(i.id) !== id);
                if (state.editingIngId === id) resetRestockForm();
                renderLevels(); renderIngredientInputs(); updateRestockSummary();
            },
            request: () => http(`${API.ingredients}/${id}`, 'DELETE'),
            rollback: () => {
                state.ingredients = prevIngredients;
                renderLevels(); renderIngredientInputs(); updateRestockSummary();
            },
        });
    }
});

function restockAmountMl() {
    const size = $('rs-size').value === 'other' ? num($('rs-other').value) : num($('rs-size').value);
    return Math.round(num($('rs-count').value) * size * 1000);
}

function updateRestockSummary() {
    if (state.editingIngId !== null) return;
    $('rs-other-wrap').hidden = $('rs-size').value !== 'other';
    const isNew = $('rs-ingredient').value === 'new';
    $('rs-new').hidden = !isNew;
    $('rs-new-legend').textContent = 'Novo produto';
    $('rs-stock-wrap').hidden = true;
    const ing = isNew ? null : state.ingredients.find((i) => i.id === Number($('rs-ingredient').value));
    const max = isNew ? Math.round(num($('rs-capacity').value) * 1000) : num(ing?.maxCapacityMl);
    const free = Math.max(0, max - num(ing?.currentQuantityMl));
    const extra = isNew ? (max ? ` · Capacidade do reservatório: ${fmtVolume(max)}` : '') : (max ? ` · Espaço livre: ${fmtVolume(free)}` : '');
    $('rs-total').textContent = `Total a adicionar: ${fmtVolume(restockAmountMl())}${extra}`;
}
['rs-ingredient', 'rs-count', 'rs-size', 'rs-other', 'rs-capacity'].forEach((id) => $(id).addEventListener('input', updateRestockSummary));

function saveEditedIngredient() {
    const id = state.editingIngId;
    const name = $('rs-name').value.trim();
    const capacityMl = Math.round(num($('rs-capacity').value) * 1000);
    const stockMl = Math.min(capacityMl, Math.max(0, Math.round(num($('rs-stock').value) * 1000)));
    const pump = normalizePump($('rs-pump').value);
    if (!name) return toast('Digite o nome do reservatório.');
    if (state.ingredients.some((i) => i.id !== id && norm(i.name) === norm(name))) {
        return toast('Já existe outro reservatório com esse nome.');
    }
    if (capacityMl <= 0) return toast('Informe a capacidade do reservatório em litros.');

    const idx = state.ingredients.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const prevIng = { ...state.ingredients[idx] };
    const body = { name, pump, pumpPin: PUMP_PIN[pump], maxCapacityMl: capacityMl, currentQuantityMl: stockMl };

    const syncDrinkNames = (targetName) => {
        state.drinks.forEach((d) => (d.recipes ?? []).forEach((r) => {
            if (r.ingredient?.id === id) r.ingredient.name = targetName;
        }));
    };

    optimistic({
        okMessage: `Reservatório ${name} atualizado.`,
        apply: () => {
            state.ingredients[idx] = { ...prevIng, ...body };
            syncDrinkNames(name);
            resetRestockForm();
            renderLevels(); renderIngredientInputs(); renderMenu();
        },
        request: () => http(`${API.ingredients}/${id}`, 'PUT', body),
        onSuccess: (updated) => {
            if (updated && pendingOps === 1) {
                const curIdx = state.ingredients.findIndex((i) => i.id === id);
                if (curIdx >= 0) state.ingredients[curIdx] = updated;
            }
        },
        rollback: () => {
            const curIdx = state.ingredients.findIndex((i) => i.id === id);
            if (curIdx >= 0) state.ingredients[curIdx] = prevIng;
            syncDrinkNames(prevIng.name);
            renderLevels(); renderIngredientInputs(); renderMenu();
        },
    });
}

function createProduct(addedMl) {
    const name = $('rs-name').value.trim();
    const capacityMl = Math.round(num($('rs-capacity').value) * 1000);
    const pump = normalizePump($('rs-pump').value);
    const pin = PUMP_PIN[pump];
    if (!name) return toast('Digite o nome do produto.');
    if (state.ingredients.some((i) => norm(i.name) === norm(name))) return toast('Já existe um produto com esse nome. Escolha-o na lista de reservatórios.');
    if (capacityMl <= 0) return toast('Informe a capacidade do reservatório em litros.');
    const filled = Math.min(addedMl, capacityMl);
    const msg = filled < addedMl
        ? `${name} cadastrado e cheio (${fmtVolume(capacityMl)}). O excedente de ${fmtVolume(addedMl - filled)} não foi adicionado.`
        : `${name} cadastrado com ${fmtVolume(filled)} na ${PUMP_LABEL[pump]}.`;

    const body = { name, pump, currentQuantityMl: filled, maxCapacityMl: capacityMl, pumpPin: pin };
    const tempId = -Date.now();
    const tempIng = { id: tempId, ...body };

    optimistic({
        okMessage: msg,
        apply: () => {
            state.ingredients.push(tempIng);
            renderLevels(); renderIngredientInputs();
            $('rs-ingredient').value = String(tempId);
            $('rs-count').value = 1;
            resetRestockForm();
        },
        request: () => http(API.ingredients, 'POST', body),
        onSuccess: (created) => {
            if (!created) return;
            const idx = state.ingredients.findIndex((i) => i.id === tempId);
            if (idx >= 0) state.ingredients[idx] = created;
            const wasSelected = $('rs-ingredient').value === String(tempId);
            renderLevels(); renderIngredientInputs();
            if (wasSelected) $('rs-ingredient').value = String(created.id);
            updateRestockSummary();
        },
        rollback: () => {
            state.ingredients = state.ingredients.filter((i) => i.id !== tempId);
            renderLevels(); renderIngredientInputs(); updateRestockSummary();
        },
    });
}

$('restock').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.editingIngId !== null) return saveEditedIngredient();
    const added = restockAmountMl();
    if (added <= 0) return toast('Informe a quantidade de garrafas e o tamanho da garrafa.');
    if ($('rs-ingredient').value === 'new') return createProduct(added);

    const ing = state.ingredients.find((i) => i.id === Number($('rs-ingredient').value));
    if (!ing) return toast('Escolha um reservatório.');
    if (ing.id < 0) return toast('Aguarde finalizar o cadastro do reservatório.');

    const prevQty = num(ing.currentQuantityMl);
    const max = num(ing.maxCapacityMl);
    const total = prevQty + added;
    const next = max ? Math.min(total, max) : total;
    const msg = next < total
        ? `${ing.name} está cheio (${fmtVolume(max)}). O excedente de ${fmtVolume(total - next)} não foi adicionado.`
        : `${ing.name}: +${fmtVolume(added)}. Agora tem ${fmtVolume(next)}.`;

    optimistic({
        okMessage: msg,
        apply: () => {
            ing.currentQuantityMl = next;
            $('rs-count').value = 1;
            renderLevels(); updateRestockSummary();
        },
        request: () => http(`${API.ingredients}/${ing.id}/stock`, 'PATCH', { currentQuantityMl: next }),
        onSuccess: (updated) => {
            if (updated && pendingOps === 1) {
                ing.currentQuantityMl = num(updated.currentQuantityMl);
                renderLevels(); updateRestockSummary();
            }
        },
        rollback: () => {
            ing.currentQuantityMl = prevQty;
            renderLevels(); updateRestockSummary();
        },
    });
});

/* ---------- drinks CRUD ---------- */

function resetDrinkForm() {
    state.editingId = null;
    $('d-name').value = '';
    fillRecipeRows();
    $('drink-form-title').textContent = 'Nova bebida';
    $('d-submit').textContent = 'Cadastrar bebida';
    $('d-cancel').hidden = true;
}

$('d-cancel').addEventListener('click', resetDrinkForm);

$('drink-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const mlOf = (id) => num(document.querySelector(`[data-ing="${id}"][data-f="ml"]`)?.value);
    const name = $('d-name').value.trim();
    const recipes = state.ingredients
        .map((i) => ({ ingredientId: i.id, quantityMl: mlOf(i.id) }))
        .filter((r) => r.quantityMl > 0);
    if (!name) return toast('Dê um nome à bebida.');
    if (!recipes.length) return toast('Informe a quantidade de pelo menos um insumo.');
    if (recipes.some((r) => r.ingredientId < 0)) return toast('Aguarde finalizar o cadastro do novo reservatório.');

    const editing = state.drinks.find((d) => d.id === state.editingId);
    const body = { name, active: editing ? editing.active !== false : true, recipes };
    const hydratedRecipes = recipes.map((r) => ({
        ingredient: state.ingredients.find((i) => i.id === r.ingredientId),
        quantityMl: r.quantityMl,
    }));

    if (editing) {
        const id = editing.id;
        const prevDrink = { ...editing, recipes: [...(editing.recipes ?? [])] };
        optimistic({
            okMessage: 'Bebida atualizada.',
            apply: () => {
                const idx = state.drinks.findIndex((d) => d.id === id);
                if (idx >= 0) state.drinks[idx] = { ...editing, name, active: body.active, recipes: hydratedRecipes };
                resetDrinkForm();
                renderMenu();
            },
            request: () => http(`${API.drinks}/${id}`, 'PUT', body),
            onSuccess: (saved) => {
                if (saved?.id && pendingOps === 1) {
                    const idx = state.drinks.findIndex((d) => d.id === id);
                    const hasNames = (saved.recipes ?? []).every((r) => r.ingredient?.name);
                    if (idx >= 0) state.drinks[idx] = hasNames ? saved : { ...saved, recipes: hydratedRecipes };
                }
            },
            rollback: () => {
                const idx = state.drinks.findIndex((d) => d.id === id);
                if (idx >= 0) state.drinks[idx] = prevDrink;
                renderMenu();
            },
        });
    } else {
        const tempId = -Date.now();
        const tempDrink = { id: tempId, name, active: true, recipes: hydratedRecipes };
        optimistic({
            okMessage: 'Bebida cadastrada.',
            apply: () => {
                state.drinks.push(tempDrink);
                resetDrinkForm();
                renderMenu();
            },
            request: () => http(API.drinks, 'POST', body),
            onSuccess: (saved) => {
                if (!saved?.id) return;
                const idx = state.drinks.findIndex((d) => d.id === tempId);
                const hasNames = (saved.recipes ?? []).every((r) => r.ingredient?.name);
                if (idx >= 0) state.drinks[idx] = hasNames ? saved : { ...saved, recipes: hydratedRecipes };
                renderMenu();
            },
            rollback: () => {
                state.drinks = state.drinks.filter((d) => d.id !== tempId);
                renderMenu();
            },
        });
    }
});

$('menu').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('.actions').dataset.id);
    if (id < 0) return toast('Aguarde finalizar o cadastro da bebida.');
    const drink = state.drinks.find((d) => Number(d.id) === id);
    if (!drink) return;

    if (btn.dataset.act === 'edit') {
        state.editingId = id;
        $('d-name').value = drink.name;
        fillRecipeRows(drink.recipes ?? []);
        $('drink-form-title').textContent = `Editar ${drink.name}`;
        $('d-submit').textContent = 'Salvar alterações';
        $('d-cancel').hidden = false;
        $('drink-form').scrollIntoView({ behavior: 'smooth' });
    } else if (btn.dataset.act === 'toggle') {
        const prev = drink.active;
        const next = prev === false;
        optimistic({
            okMessage: next ? `A bebida ${drink.name} voltou ao cardápio.` : `A bebida ${drink.name} foi ocultada do cardápio.`,
            apply: () => { drink.active = next; renderMenu(); },
            request: () => http(`${API.drinks}/${id}/status?active=${next}`, 'PATCH'),
            rollback: () => { drink.active = prev; renderMenu(); },
        });
    } else if (btn.dataset.act === 'delete') {
        const related = state.orders.filter((o) => Number(o.drink?.id) === id);
        let extra = '';
        if (related.length) {
            const lastDate = new Date(Math.max(...related.map((o) => toDate(o.dateTime).getTime())));
            extra = `• Pedidos que serão apagados: ${related.length} (último em ${lastDate.toLocaleDateString('pt-BR')})\n\n`;
        }
        const msg = `Excluir "${drink.name}"?\n\n`
            + extra
            + 'ATENÇÃO: Ao excluir esta bebida, todos os pedidos dela também serão removidos permanentemente do histórico e dos gráficos/relatórios.\n\n'
            + 'Recomendação: exclua apenas bebidas que não são usadas há bastante tempo. Se quiser só tirar da tela de operação sem perder os dados, use "Ocultar do cardápio".';

        if (confirm(msg)) {
            const prevDrinks = [...state.drinks];
            const prevOrders = [...state.orders];
            optimistic({
                okMessage: `A bebida ${drink.name} foi excluída.`,
                apply: () => {
                    state.drinks = state.drinks.filter((d) => Number(d.id) !== id);
                    state.orders = state.orders.filter((o) => Number(o.drink?.id) !== id);
                    if (state.editingId === id) resetDrinkForm();
                    renderMenu(); renderHistory(); renderReports();
                },
                request: () => http(`${API.drinks}/${id}`, 'DELETE'),
                rollback: () => {
                    state.drinks = prevDrinks;
                    state.orders = prevOrders;
                    renderMenu(); renderHistory(); renderReports();
                },
            });
        }
    }
});

/* ---------- mock mode (?mock=1) ---------- */

const mockDb = MOCK ? (() => {
    const ing = (id, name, pump, cur, max) => ({ id, name, pump, currentQuantityMl: cur, maxCapacityMl: max, pumpPin: PUMP_PIN[pump] });
    const ingredients = [ing(1, 'Suco de limão', 'A', 820, 2000), ing(2, 'Maracujá', 'B', 310, 2000), ing(3, 'Água com gás', 'A', 1650, 3000), ing(4, 'Xarope de hortelã', 'B', 90, 1000)];
    const use = (i, quantityMl) => ({ ingredient: ingredients[i], quantityMl });
    const drinks = [
        { id: 1, name: 'Suco de limão', active: true, recipes: [use(0, 60), use(2, 140)] },
        { id: 2, name: 'Maracujá', active: true, recipes: [use(1, 80), use(2, 120)] },
        { id: 3, name: 'Mojito sem álcool', active: true, recipes: [use(0, 40), use(3, 20), use(2, 140)] },
        { id: 4, name: 'Refresco de hortelã', active: false, recipes: [use(3, 60), use(2, 150)] },
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
    const recipesOf = (list) => list.map((r) => ({ ingredient: ingredients.find((i) => i.id === r.ingredientId), quantityMl: r.quantityMl }));
    if (path === API.ingredients && method === 'POST') { const i = { id: Math.max(0, ...ingredients.map((x) => x.id)) + 1, ...body }; ingredients.push(i); return i; }
    if (path === API.ingredients) return ingredients;
    if (path.startsWith(`${API.ingredients}/`) && method === 'PUT') {
        const i = ingredients.find((x) => x.id === id);
        Object.assign(i, body);
        return i;
    }
    if (path.startsWith(`${API.ingredients}/`) && method === 'DELETE') {
        const idx = ingredients.findIndex((x) => x.id === id);
        if (idx >= 0) ingredients.splice(idx, 1);
        return null;
    }
    if (path.endsWith('/stock')) { const i = ingredients.find((x) => x.id === id); i.currentQuantityMl = body.currentQuantityMl; return i; }
    if (path === API.orders) return orders;
    if (path === API.drinks && method === 'GET') return drinks;
    if (path === API.drinks) { const d = { id: mockDb.nextId++, name: body.name, active: body.active, recipes: recipesOf(body.recipes) }; drinks.push(d); return d; }
    const d = drinks.find((x) => x.id === id);
    if (method === 'DELETE') { drinks.splice(drinks.indexOf(d), 1); return null; }
    if (path.endsWith('/status')) { d.active = query.includes('active=true'); return null; }
    Object.assign(d, { name: body.name, recipes: recipesOf(body.recipes) });
    return d;
}

/* ---------- boot ---------- */

load();
if (!MOCK) setInterval(() => { if (pendingOps === 0) load(); }, 15000);