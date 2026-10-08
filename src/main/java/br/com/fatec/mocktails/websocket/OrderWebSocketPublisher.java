package br.com.fatec.mocktails.websocket;

import br.com.fatec.mocktails.models.Order;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class OrderWebSocketPublisher {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    public void notifyOrderUpdate(Order order) {
        messagingTemplate.convertAndSend("/topic/orders", order);
    }
}