package br.com.fatec.mocktails.controllers;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/test/esp")
public class EspTestController {    

    private final SimpMessagingTemplate messagingTemplate;

    public EspTestController(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    @PostMapping("/event")
    public Map<String, String> sendEvent(
            @RequestBody Map<String, Object> event) {

        messagingTemplate.convertAndSend(
            "/topic/esp/status",
            (Object) event
        );

        return Map.of("message", "Evento enviado com sucesso!");
    }
}