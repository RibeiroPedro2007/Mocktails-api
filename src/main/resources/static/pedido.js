
const API_URL = window.location.origin;

let selectedDrink = null;
let quantity = 1;
let currentOrderId = null;
let stompClient = null;

async function loadDrinks() {

    const container = document.getElementById("drinksContainer");

    try {

        const response = await fetch(`${API_URL}/api/drinks`);

        if (!response.ok) {
            throw new Error("Erro ao carregar bebidas.");
        }

        const drinks = await response.json();

        container.innerHTML = "";

        drinks.forEach(drink => {

            const card = document.createElement("article");
            card.className = "drink-card";

            card.innerHTML = `
                <div class="drink-image">🍹</div>
                <div class="drink-info">
                    <h3></h3>
                    <p></p>
                </div>
            `;

            card.querySelector("h3").textContent =
                drink.name || drink.nome || "Bebida";

            card.querySelector("p").textContent =
                drink.description || drink.descricao || "Bebida especial";

            card.onclick = () => {

                document.querySelectorAll(".drink-card")
                    .forEach(item => item.classList.remove("selected"));

                card.classList.add("selected");

                selectedDrink = drink;

                updateOrderButton();
            };

            container.appendChild(card);
        });

    } catch (error) {

        container.textContent = error.message;

        console.error(error);
    }
}

// QUANTIDADE

document.getElementById("minusBtn").onclick = () => {

    if (quantity > 1) {
        quantity--;
        updateQuantity();
    }
};

document.getElementById("plusBtn").onclick = () => {

    if (quantity < 20) {
        quantity++;
        updateQuantity();
    }
};

function updateQuantity() {

    document.getElementById("quantity").textContent = quantity;

    updateOrderButton();
}

function updateOrderButton() {

    const button = document.getElementById("orderBtn");

    button.disabled = !selectedDrink;

    button.textContent = selectedDrink
        ? `Solicitar ${quantity} copo(s)`
        : "Escolha uma bebida";
}

// CRIAR PEDIDO

document.getElementById("orderBtn").onclick = createOrder;

async function createOrder() {

    if (!selectedDrink) return;

    const button = document.getElementById("orderBtn");

    button.disabled = true;
    button.textContent = "Enviando pedido...";

    try {

        const response = await fetch(`${API_URL}/api/orders`, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                drinkId: selectedDrink.id,
                copos: quantity
            })
        });

        const data = await response.json();

        if (!response.ok) {

            throw new Error(
                data.message || data.error || "Erro ao realizar pedido."
            );
        }

        if (!data.id) {
            throw new Error("A API não retornou o ID do pedido.");
        }

        currentOrderId = data.id;

        document.getElementById("menuSection").classList.add("hidden");

        document.getElementById("trackingSection")
            .classList.remove("hidden");

        document.getElementById("orderId").textContent = currentOrderId;

        updateOrderStatus(data.status || "PENDING");

        window.scrollTo(0, 0);

    } catch (error) {

        alert(error.message);

    } finally {

        button.disabled = false;
        updateOrderButton();
    }
}

// WEBSOCKET STOMP

function connectWebSocket() {

    stompClient = new StompJs.Client({

        webSocketFactory: () =>
            new SockJS(`${API_URL}/ws-mocktails`),

        reconnectDelay: 5000,

        onConnect: () => {

            console.log("Totem conectado!");

            stompClient.subscribe("/topic/orders", message => {

                const order = JSON.parse(message.body);

                if (Number(order.id) === Number(currentOrderId)) {
                    updateOrderStatus(order.status);
                }
            });

            stompClient.subscribe("/topic/esp/status", message => {

                try {

                    const event = JSON.parse(message.body);

                    handleEspEvent(event);

                } catch (error) {

                    console.error(error);
                }
            });
        }
    });

    stompClient.activate();
}

// STATUS

function updateOrderStatus(status) {

    const states = {

        PENDING: [
            "Pedido recebido!",
            "Aguardando a máquina iniciar.",
            "Pedido pendente",
            "10%"
        ],

        PREPARING: [
            "Preparando sua bebida!",
            "Nossa máquina está trabalhando.",
            "Preparação em andamento",
            "65%"
        ],

        COMPLETED: [
            "Sua bebida está pronta!",
            "Obrigado por escolher Mocktails!",
            "Pedido finalizado",
            "100%"
        ],

        CANCELLED: [
            "Pedido cancelado",
            "Seu pedido foi cancelado.",
            "Cancelado",
            "0%"
        ],

        NEED_CUPS: [
            "Aguardando copos",
            "Precisamos repor os copos.",
            "Aguardando reposição",
            "10%"
        ]
    };

    const state = states[status] || states.PENDING;

    document.getElementById("trackingTitle").textContent = state[0];

    document.getElementById("trackingMessage").textContent = state[1];

    document.getElementById("orderStatus").textContent = state[2];

    document.getElementById("progressBar").style.width = state[3];
}

// EVENTOS ESP32

// EVENTOS ESP32

function handleEspEvent(event) {

    if (Number(event.pedidoId) !== Number(currentOrderId)) {
        return;
    }

    switch (event.estado) {

        case "ERRO_COPOS": {
            const faltam = event.pedidos - event.atendidos;

            document.getElementById("cupAlert").classList.remove("hidden");

            document.getElementById("cupMessage").textContent =
                `Faltam ${faltam} copo(s). Coloque-os na base e clique em continuar.`;

            updateOrderStatus("NEED_CUPS");
            break;
        }

        case "PROCURANDO":
        case "ENCHENDO":
            document.getElementById("cupAlert").classList.add("hidden");
            updateOrderStatus("PREPARING");
            break;

        case "CONCLUIDO":
            document.getElementById("cupAlert").classList.add("hidden");
            updateOrderStatus("COMPLETED");
            break;
    }
}

// NOVO PEDIDO

document.getElementById("newOrderBtn").onclick = () => {

    selectedDrink = null;
    currentOrderId = null;
    quantity = 1;

    updateQuantity();

    document.getElementById("cupAlert").classList.add("hidden");

    document.getElementById("trackingSection").classList.add("hidden");

    document.getElementById("menuSection").classList.remove("hidden");

    document.querySelectorAll(".drink-card")
        .forEach(card => card.classList.remove("selected"));

    window.scrollTo(0, 0);
};
// CONTINUAR DEPOIS DE REPOR COPOS

const continueBtn = document.getElementById("continueBtn");

if (continueBtn) {

    continueBtn.onclick = async () => {

        try {

            const response = await fetch(
                `${API_URL}/api/orders/${currentOrderId}/continuar`,
                { method: "POST" }
            );

            if (!response.ok) {
                throw new Error("Não foi possível avisar a máquina.");
            }

            document.getElementById("cupAlert").classList.add("hidden");

            updateOrderStatus("PREPARING");

        } catch (error) {

            alert(error.message);
        }
    };
}
// INICIALIZAÇÃO

document.addEventListener("DOMContentLoaded", () => {

    loadDrinks();

    connectWebSocket();
});
