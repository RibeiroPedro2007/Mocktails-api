package br.com.fatec.mocktails.services;

import br.com.fatec.mocktails.dto.OrderRequestDTO;
import br.com.fatec.mocktails.models.Drink;
import br.com.fatec.mocktails.models.Ingredient;
import br.com.fatec.mocktails.models.Order;
import br.com.fatec.mocktails.models.Recipe;
import br.com.fatec.mocktails.repositories.DrinkRepository;
import br.com.fatec.mocktails.repositories.IngredientRepository;
import br.com.fatec.mocktails.repositories.OrderRepository;
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

    public List<Order> findAll(){
        return orderRepository.findAll();
    }
    @Transactional
    public Order createOrder(OrderRequestDTO dto) {
        Drink drink = drinkService.findById(dto.getDrinkId());

        //check if there is enough stock of ALL the drink's ingredients.
        for (Recipe recipe : drink.getRecipes()) {
            Ingredient ingredient = recipe.getIngredient();
            if (ingredient.getCurrentQuantityMl() < recipe.getQuantityMl()) {
                throw new RuntimeException("Insufficient stock for ingredient: " + ingredient.getName());
            }
        }

        //down stok
        for (Recipe recipe : drink.getRecipes()) {
            Ingredient ingredient = recipe.getIngredient();
            ingredient.setCurrentQuantityMl(ingredient.getCurrentQuantityMl() - recipe.getQuantityMl());
            ingredientRepository.save(ingredient);
        }

        //save the new order order kkkkk(ordem de pedido)
        Order order = new Order();
        order.setDrink(drink);
        order.setDateTime(LocalDateTime.now());
        order.setStatus("PENDING");

        return orderRepository.save(order);
    }
}
