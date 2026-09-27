package br.com.fatec.mocktails.websocket;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class Esp32WebSocketHandler extends TextWebSocketHandler {

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
}