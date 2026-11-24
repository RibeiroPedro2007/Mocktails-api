package br.com.fatec.mocktails.controllers;

import br.com.fatec.mocktails.dto.OrderRequestDTO;
import br.com.fatec.mocktails.models.Order;
import br.com.fatec.mocktails.services.OrderService;
import br.com.fatec.mocktails.websocket.Esp32WebSocketHandler;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @Autowired
    private OrderService orderService;

    @Autowired
    private Esp32WebSocketHandler esp32WebSocketHandler;

    @GetMapping
    public ResponseEntity<List<Order>> getAllOrders() {
        List<Order> orders = orderService.findAll();
        return ResponseEntity.ok(orders);
    }

    // Cria um novo pedido (baixa estoque, aciona ESP32 e avisa a tela)
    @PostMapping
    public ResponseEntity<Order> createOrder(@RequestBody OrderRequestDTO dto) {
        Order newOrder = orderService.createOrder(dto);
        return ResponseEntity.status(201).body(newOrder);
    }

    // Cancela o pedido e estorna o estoque dos ingredientes
    @PatchMapping("/{id}/cancel")
    public ResponseEntity<Order> cancelOrder(@PathVariable Long id) {
        Order cancelledOrder = orderService.cancelOrder(id);
        return ResponseEntity.ok(cancelledOrder);
    }

    // Depois de repor os copos: manda o ESP32 verificar de novo
    @PostMapping("/{id}/continuar")
    public ResponseEntity<Void> continuar(@PathVariable Long id) {
        return esp32WebSocketHandler.sendContinue()
                ? ResponseEntity.accepted().build()
                : ResponseEntity.status(503).build();   // ESP32 offline
    }

    // Para o ESP32 e desliga as bombas
    @PostMapping("/{id}/parar")
    public ResponseEntity<Void> parar(@PathVariable Long id) {
        return esp32WebSocketHandler.sendStop()
                ? ResponseEntity.accepted().build()
                : ResponseEntity.status(503).build();
    }
}