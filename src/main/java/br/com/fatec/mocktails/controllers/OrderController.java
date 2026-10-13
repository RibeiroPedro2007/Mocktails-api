package br.com.fatec.mocktails.controllers;

import br.com.fatec.mocktails.dto.OrderRequestDTO;
import br.com.fatec.mocktails.models.Order;
import br.com.fatec.mocktails.services.OrderService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @Autowired
    private OrderService orderService;

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
}
