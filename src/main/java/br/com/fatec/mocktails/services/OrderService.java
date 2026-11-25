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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class OrderService {
    @Autowired
    private OrderRepository orderRepository;
    @Autowired
    private DrinkService drinkService;
    @Autowired
    private IngredientRepository ingredientRepository;
    @Autowired
    private OrderWebSocketPublisher orderWebSocketPublisher;
    @Autowired
    private Esp32WebSocketHandler esp32WebSocketHandler;

    public List<Order> findAll() {
        return orderRepository.findAll();
    }

    @Transactional
    public Order createOrder(OrderRequestDTO dto) {
        if (!esp32WebSocketHandler.isEspConnected()) {
            throw new RuntimeException(
                "ESP32 offline: não é possível iniciar o pedido."
            );
        }
        Drink drink = drinkService.findById(dto.getDrinkId());
        // 3. Define a quantidade de copos
        int copos = (dto.getCopos() == null || dto.getCopos() < 1)
                ? 1
                : dto.getCopos();
        // 4. Verifica se existem receitas cadastradas
        if (drink.getRecipes() == null || drink.getRecipes().isEmpty()) {
            throw new RuntimeException(
                "A bebida não possui ingredientes cadastrados: "
                + drink.getName()
            );
        }
        // 5. Valida ingredientes, bombas e estoque
        for (Recipe recipe : drink.getRecipes()) {
            Ingredient ingredient = recipe.getIngredient();
            if (ingredient == null) {
                throw new RuntimeException(
                    "Receita possui ingrediente inválido."
                );
            }
            String pump = ingredient.getPump();

            if (pump == null || (!pump.equals("A") && !pump.equals("B"))) {
                throw new RuntimeException(
                    "Ingrediente sem bomba A/B: " + ingredient.getName()
                );
            }
            double quantidadeNecessaria = recipe.getQuantityMl() * copos;

            if (ingredient.getCurrentQuantityMl()
                    < quantidadeNecessaria) {

                throw new RuntimeException(
                    "Estoque insuficiente para: "
                    + ingredient.getName()
                );
            }
        }
        // 6. Cria o pedido
        Order order = new Order();

        order.setDrink(drink);
        order.setCopos(copos);
        order.setDateTime(LocalDateTime.now());
        order.setStatus("PENDING");

        Order savedOrder = orderRepository.save(order);

        // 7. Monta a receita para enviar ao ESP32
        List<Map<String, Object>> receita = new ArrayList<>();
        for (Recipe recipe : drink.getRecipes()) {
            receita.add(Map.of(
                "bomba", recipe.getIngredient().getPump(),
                "quantidadeMl", recipe.getQuantityMl()
            ));
        }
        // 8. Envia a solicitação ao ESP32
        boolean enviado = esp32WebSocketHandler.sendOrder(
            savedOrder.getId(),
            copos,
            receita
        );

        if (!enviado) {
            throw new RuntimeException(
                "Falha ao enviar pedido para o ESP32."
            );
        }
        // 9. Atualiza estoque dos ingredientes
        for (Recipe recipe : drink.getRecipes()) {
            Ingredient ingredient = recipe.getIngredient();

            double quantidadeUtilizada = recipe.getQuantityMl() * copos;

            ingredient.setCurrentQuantityMl(
                ingredient.getCurrentQuantityMl()
                - quantidadeUtilizada
            );
            ingredientRepository.save(ingredient);
        }
        // 10. Atualiza a interface web
        orderWebSocketPublisher.notifyOrderUpdate(savedOrder);
        return savedOrder;
    }

    @Transactional
    public Order cancelOrder(Long id) {

        Order order = orderRepository.findById(id)
            .orElseThrow(() ->
                new RuntimeException(
                    "Pedido não encontrado: " + id
                )
            );
        // Verifica se já foi cancelado
        if ("CANCELLED".equals(order.getStatus())) {
            throw new RuntimeException(
                "O pedido já foi cancelado."
            );
        }
        // Impede cancelamento de pedido já finalizado
        if ("COMPLETED".equals(order.getStatus())) {
            throw new RuntimeException(
                "Não é possível cancelar um pedido finalizado."
            );
        }
        // Devolve o estoque dos ingredientes
        Drink drink = order.getDrink();

        int copos = order.getCopos() == null ? 1 : order.getCopos();

        for (Recipe recipe : drink.getRecipes()) {
            Ingredient ingredient = recipe.getIngredient();
            ingredient.setCurrentQuantityMl(
                ingredient.getCurrentQuantityMl()
                + recipe.getQuantityMl() * copos
            );

            ingredientRepository.save(ingredient);
        }
        // Atualiza status
        order.setStatus("CANCELLED");
        Order savedOrder = orderRepository.save(order);

        // Atualiza interface web
        orderWebSocketPublisher.notifyOrderUpdate(savedOrder);
        return savedOrder;
    }
}   