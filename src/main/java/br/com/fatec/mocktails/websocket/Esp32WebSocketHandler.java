package br.com.fatec.mocktails.websocket;

import br.com.fatec.mocktails.models.Order;
import br.com.fatec.mocktails.repositories.OrderRepository;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

@Component
public class Esp32WebSocketHandler extends TextWebSocketHandler {

    // Sessões conectadas do ESP32
    private final CopyOnWriteArrayList<WebSocketSession> sessions =
            new CopyOnWriteArrayList<>();

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    private OrderWebSocketPublisher orderWebSocketPublisher;

    @Autowired
    private OrderRepository orderRepository;


    // =====================================================
    // ESP32 CONECTOU
    // =====================================================

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {

        sessions.add(session);

        System.out.println("================================");
        System.out.println("ESP32 CONECTADO!");
        System.out.println("ID: " + session.getId());
        System.out.println("Total de conexões: " + sessions.size());
        System.out.println("================================");

        orderWebSocketPublisher.notifyEspStatus(
                "{\"status\":\"ONLINE\"}"
        );
    }


    // =====================================================
    // VERIFICAR SE ESP32 ESTÁ CONECTADO
    // =====================================================

    public boolean isEspConnected() {

        sessions.removeIf(session ->
                !session.isOpen()
        );

        return !sessions.isEmpty();
    }


    // =====================================================
    // ENVIAR PEDIDO PARA O ESP32
    // =====================================================

    public boolean sendOrder(
            Long pedidoId,
            int copos,
            List<Map<String, Object>> receita) {

        if (!isEspConnected()) {
            System.out.println("ESP32 OFFLINE!");
            return false;
        }

        try {

            // Monta o JSON
            Map<String, Object> pedido = new LinkedHashMap<>();

            pedido.put("pedidoId", pedidoId);
            pedido.put("acao", "PREPARAR");
            pedido.put("quantidadeCopos", copos);
            pedido.put("receita", receita);

            String json = objectMapper.writeValueAsString(pedido);

            // Envia para as sessões conectadas
            boolean enviado = false;

            for (WebSocketSession session : sessions) {

                if (session.isOpen()) {

                    synchronized (session) {

                        session.sendMessage(
                                new TextMessage(json)
                        );

                    }

                    enviado = true;

                    System.out.println("PEDIDO ENVIADO AO ESP32:");
                    System.out.println(json);
                }
            }

            return enviado;

        } catch (Exception e) {

            System.out.println(
                    "ERRO AO ENVIAR PEDIDO AO ESP32: "
                            + e.getMessage()
            );
            e.printStackTrace();

            return false;
        }
    }


    // =====================================================
    // CONTINUAR (depois de repor os copos) E PARAR
    // =====================================================

    public boolean sendContinue() {
        return sendCommand("CONTINUAR");
    }

    public boolean sendStop() {
        return sendCommand("PARAR");
    }

    private boolean sendCommand(String acao) {

        if (!isEspConnected()) {
            System.out.println("ESP32 OFFLINE!");
            return false;
        }

        try {

            String json = objectMapper.writeValueAsString(
                    Map.of("acao", acao)
            );

            boolean enviado = false;

            for (WebSocketSession session : sessions) {

                if (session.isOpen()) {

                    synchronized (session) {
                        session.sendMessage(new TextMessage(json));
                    }

                    enviado = true;
                }
            }

            System.out.println("COMANDO ENVIADO AO ESP32: " + json);

            return enviado;

        } catch (Exception e) {

            System.out.println(
                    "ERRO AO ENVIAR COMANDO AO ESP32: "
                            + e.getMessage()
            );
            e.printStackTrace();

            return false;
        }
    }
    // RECEBER MENSAGENS DO ESP32
    @Override
    protected void handleTextMessage(
            WebSocketSession session,
            TextMessage message) throws Exception {

        String dadosRecebidos = message.getPayload();

        System.out.println("================================");
        System.out.println("MENSAGEM RECEBIDA DO ESP32:");
        System.out.println(dadosRecebidos);
        System.out.println("================================");

        // Só encaminha para o front se o pedido não estiver cancelado
        if (atualizarStatusPedido(dadosRecebidos)) {
            orderWebSocketPublisher.notifyEspStatus(dadosRecebidos);
        }
    }

    private boolean atualizarStatusPedido(String payloadJson) {
        try {
            JsonNode json = objectMapper.readTree(payloadJson);

            if (!json.hasNonNull("pedidoId") || !json.hasNonNull("estado")) {
                return true;
            }
            Long pedidoId = json.get("pedidoId").asLong();
            String estadoEsp = json.get("estado").asText();

            var optOrder = orderRepository.findById(pedidoId);
            if (optOrder.isPresent() && "CANCELLED".equals(optOrder.get().getStatus())) {
                return false; // ignora mensagem atrasada de pedido cancelado
            }

            String novoStatus = mapearEstadoParaStatus(estadoEsp);
            if (novoStatus == null) {
                return true;
            }

            optOrder.ifPresent(order -> {
                if (!novoStatus.equals(order.getStatus())) {
                    order.setStatus(novoStatus);
                    Order pedidoAtualizado = orderRepository.save(order);
                    orderWebSocketPublisher.notifyOrderUpdate(pedidoAtualizado);
                }
            });

            return true;
        } catch (Exception e) {
            System.out.println("ERRO AO ATUALIZAR PEDIDO VIA ESP32: " + e.getMessage());
            return true;
        }
    }
    private String mapearEstadoParaStatus(String estadoEsp) {

        return switch (estadoEsp) {
            case "PROCURANDO", "ENCHENDO" -> "PREPARING";
            case "ERRO_COPOS" -> "NEED_CUPS";
            case "CONCLUIDO" -> "COMPLETED";
            case "ERRO" -> "ERROR";
            default -> null;
        };
    }

    // ESP32 DESCONECTOU
    @Override
    public void afterConnectionClosed(
            WebSocketSession session,
            CloseStatus status) {

        sessions.remove(session);

        System.out.println("ESP32 DESCONECTADO!");
        System.out.println("Total de conexões: " + sessions.size());

        if (sessions.isEmpty()) {

            orderWebSocketPublisher.notifyEspStatus(
                    "{\"status\":\"OFFLINE\"}"
            );
        }
    }
    // TRATAR ERROS
    @Override
    public void handleTransportError(
            WebSocketSession session,
            Throwable exception) throws Exception {
        System.out.println(
                "ERRO NA CONEXÃO ESP32: "
                        + exception.getMessage()
        );
        sessions.remove(session);
        if (session.isOpen()) {
            session.close();
        }
        if (sessions.isEmpty()) {
            orderWebSocketPublisher.notifyEspStatus(
                    "{\"status\":\"OFFLINE\"}"
            );
        }
    }
    // =====================================================
    // MÉTODO ANTIGO - MANTIDO PARA COMPATIBILIDADE
    // =====================================================
    public void sendOrderToEsp32(Order order) {

        try {
            Map<String, Object> mensagem = new LinkedHashMap<>();

            mensagem.put("pedidoId", order.getId());
            mensagem.put("acao", "PEDIDO");

            String json = objectMapper.writeValueAsString(mensagem);

            for (WebSocketSession session : sessions) {

                if (session.isOpen()) {

                    synchronized (session) {
                        session.sendMessage(new TextMessage(json));
                    }
                }
            }

        } catch (IOException e) {
            System.out.println(
                    "Erro ao enviar pedido: " + e.getMessage()
            );
        }
    }

    // =====================================================
    // CANCELAR PEDIDO NO ESP32
    // =====================================================

    public boolean sendCancelOrder(Long pedidoId) {

        if (!isEspConnected()) {
            System.out.println("ESP32 OFFLINE! Cancelamento salvo apenas no banco.");
            return false;
        }

        try {
            Map<String, Object> mensagem = new LinkedHashMap<>();
            mensagem.put("pedidoId", pedidoId);
            mensagem.put("acao", "CANCELAR");
            mensagem.put("status", "CANCELLED");

            String json = objectMapper.writeValueAsString(mensagem);

            boolean enviado = false;

            for (WebSocketSession session : sessions) {
                if (session.isOpen()) {
                    synchronized (session) {
                        session.sendMessage(new TextMessage(json));
                    }
                    enviado = true;
                }
            }

            System.out.println("CANCELAMENTO ENVIADO AO ESP32: " + json);

            return enviado;

        } catch (Exception e) {
            System.out.println("ERRO AO ENVIAR CANCELAMENTO AO ESP32: " + e.getMessage());
            e.printStackTrace();
            return false;
        }
    }
}