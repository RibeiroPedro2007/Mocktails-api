package br.com.fatec.mocktails.websocket;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class Esp32WebSocketConfig implements WebSocketConfigurer {

    @Autowired
    private Esp32WebSocketHandler esp32WebSocketHandler;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // O ESP32 vai se CONECTAR em: ws://IP_DO_SERVER:8080/ws-esp32
        registry.addHandler(esp32WebSocketHandler, "/ws-esp32")
                .setAllowedOrigins("*"); //Essa fita permite conexão direta da placa
    }
}