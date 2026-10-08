package br.com.fatec.mocktails.services;

import br.com.fatec.mocktails.dto.OrderRequestDTO;
import br.com.fatec.mocktails.models.Drink;
import br.com.fatec.mocktails.models.Ingredient;
import br.com.fatec.mocktails.models.Order;
import br.com.fatec.mocktails.models.Recipe;
import br.com.fatec.mocktails.repositories.IngredientRepository;
import br.com.fatec.mocktails.repositories.OrderRepository;
import br.com.fatec.mocktails.websocket.Esp32WebSocketHandler;
import br.com.fatec.mocktails.websocket.OrderWebSocketPublisher;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class OrderService {
    @Autowired
    private OrderRepository orderRepository;
    @Autowired
    private DrinkService drinkService;
    @Autowired
    private IngredientRepository ingredientRepository;
    @Autowired
    private OrderWebSocketPublisher orderWebSocketPublisher; // Call to WEB Screen
    @Autowired
    private Esp32WebSocketHandler esp32WebSocketHandler;// Call to ESP32

    public List<Order> findAll(){
        return orderRepository.findAll();
    }

    @Transactional
    public Order createOrder(OrderRequestDTO dto) {
        Drink drink = drinkService.findById(dto.getDrinkId());

        // Check if there is enough stock of ALL the drink's ingredients.
        for (Recipe recipe : drink.getRecipes()) {
            Ingredient ingredient = recipe.getIngredient();
            if (ingredient.getCurrentQuantityMl() < recipe.getQuantityMl()) {
                throw new RuntimeException("Insufficient stock for ingredient: " + ingredient.getName());
            }
        }

        // Down stock
        for (Recipe recipe : drink.getRecipes()) {
            Ingredient ingredient = recipe.getIngredient();
            ingredient.setCurrentQuantityMl(ingredient.getCurrentQuantityMl() - recipe.getQuantityMl());
            ingredientRepository.save(ingredient);
        }

        // Save the new order
        Order order = new Order();
        order.setDrink(drink);
        order.setDateTime(LocalDateTime.now());
        order.setStatus("PENDING");

        Order savedOrder = orderRepository.save(order);

        // Send for WEB (update the HTML no needs F5, its STOMP /topic/orders)
        orderWebSocketPublisher.notifyOrderUpdate(savedOrder);

        // Send for ESP32 (send a JSON with pins and time for bombs)
        esp32WebSocketHandler.sendOrderToEsp32(savedOrder);

        return savedOrder;
    }
}