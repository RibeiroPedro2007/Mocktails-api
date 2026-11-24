
package br.com.fatec.mocktails.websocket;

import br.com.fatec.mocktails.models.Order;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class OrderWebSocketPublisher {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;


    // Atualiza os pedidos na interface web
    public void notifyOrderUpdate(Order order) {

        messagingTemplate.convertAndSend(
                "/topic/orders",
                order
        );
    }


    // Atualiza o status de conexão e mensagens do ESP32
    public void notifyEspStatus(String statusJson) {

        messagingTemplate.convertAndSend(
                "/topic/esp/status",
                statusJson
        );
    }
}
