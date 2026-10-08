package br.com.fatec.mocktails.websocket;

import br.com.fatec.mocktails.models.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.concurrent.CopyOnWriteArrayList;

@Component
public class Esp32WebSocketHandler extends TextWebSocketHandler {
    // Guarda as sessões ativas do ESP32
    private final CopyOnWriteArrayList<WebSocketSession> sessions = new CopyOnWriteArrayList<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    // Roda quando o ESP32 conecta no Wi-Fi e acha a API
    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        System.out.println("ESP32 CONECTADO! ID da sessão: " + session.getId());
    }

    // Roda quando o ESP32 envia um texto/JSON para o Java
    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String dadosRecebidos = message.getPayload();
        System.out.println("Mensagem vinda do ESP32: " + dadosRecebidos);

        if (dadosRecebidos.contains("STATUS_OK")) {
            session.sendMessage(new TextMessage("Java recebeu seu status!"));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        System.out.println("ESP32 DESCONECTADO DA API");
    }

    // MÉTODO QUE O ORDER SERVICE CHAMA PARA MANDAR O PEDIDO PRO ESP32
    public void sendOrderToEsp32(Order order) {
        for (WebSocketSession session : sessions) {
            if (session.isOpen()) {
                try {
                    String json = objectMapper.writeValueAsString(order);
                    session.sendMessage(new TextMessage(json));
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }
}