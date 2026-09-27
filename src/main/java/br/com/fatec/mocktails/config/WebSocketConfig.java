package br.com.fatec.mocktails.config;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker // Fita que habilita o servidor WebSocket no Spring
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // TÓPICOS DE SAÍDA (Onde o Java transmite mensagens para quem estiver ouvindo)
        // A tela e o ESP32 vão se "inscrever" em canais que começam com /topic
        config.enableSimpleBroker("/topic");

        // PREFIXO DE ENTRADA (Para onde a tela/ESP32 envia os dados de volta para o Java)
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // PONTO DE CONEXÃO INICIAL (HANDSHAKE)
        // URL física onde o cliente abre o canal WebSocket.
        registry.addEndpoint("/ws-mocktails")
                .setAllowedOriginPatterns("*") // Libera para qualquer tela/ESP32 se conectar
                .withSockJS(); // Fallback caso o navegador antigo não suporte WebSocket nativo
    }
}