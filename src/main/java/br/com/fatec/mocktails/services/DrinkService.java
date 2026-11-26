package br.com.fatec.mocktails.services;

import br.com.fatec.mocktails.dto.DrinkRequestDTO;
import br.com.fatec.mocktails.dto.RecipeRequestDTO;
import br.com.fatec.mocktails.models.Drink;
import br.com.fatec.mocktails.models.Ingredient;
import br.com.fatec.mocktails.models.Recipe;
import br.com.fatec.mocktails.repositories.DrinkRepository;
import br.com.fatec.mocktails.repositories.IngredientRepository;
import br.com.fatec.mocktails.repositories.OrderRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class DrinkService {
    @Autowired
    private DrinkRepository drinkRepository;
    @Autowired
    private IngredientRepository ingredientRepository;
    @Autowired
    private OrderRepository orderRepository;

    public List<Drink> findAllActive() {
        return drinkRepository.findByActiveTrue();
    }

    public List<Drink> findAll(boolean all) {
        if (all) {
            return drinkRepository.findAll();
        }
        return drinkRepository.findByActiveTrue();
    }

    public Drink findById(Long id) {
        return drinkRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Drink not found with id: " + id));
    }

    @Transactional
    public Drink create(DrinkRequestDTO dto) {
        Drink drink = new Drink();
        drink.setName(dto.getName());
        drink.setActive(dto.getActive() != null ? dto.getActive() : true);
        populateRecipes(drink, dto.getRecipes());
        return drinkRepository.save(drink);
    }

    @Transactional
    public Drink update(Long id, DrinkRequestDTO dto) {
        Drink drink = findById(id);
        drink.setName(dto.getName());
        if (dto.getActive() != null) {
            drink.setActive(dto.getActive());
        }
        drink.getRecipes().clear();
        populateRecipes(drink, dto.getRecipes());
        return drinkRepository.save(drink);
    }

    private void populateRecipes(Drink drink, List<RecipeRequestDTO> items) {
        if (items == null || items.isEmpty()) return;

        List<Long> ids = items.stream()
                .map(RecipeRequestDTO::getIngredientId)
                .distinct()
                .collect(Collectors.toList());

        Map<Long, Ingredient> ingredientsById = ingredientRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(Ingredient::getId, Function.identity()));

        for (RecipeRequestDTO item : items) {
            Ingredient ingredient = ingredientsById.get(item.getIngredientId());
            if (ingredient == null) {
                throw new RuntimeException("Ingredient not found with id: " + item.getIngredientId());
            }

            Recipe recipe = new Recipe();
            recipe.setDrink(drink);
            recipe.setIngredient(ingredient);
            recipe.setQuantityMl(item.getQuantityMl());
            drink.getRecipes().add(recipe);
        }
    }

    @Transactional
    public void SetDrinkActivation(Long id, Boolean active) {
        int updated = drinkRepository.updateActiveStatus(id, active);
        if (updated == 0) {
            throw new RuntimeException("Drink not found with id: " + id);
        }
    }

    @Transactional
    public void delete(Long id) {
        orderRepository.deleteByDrinkId(id);
        drinkRepository.deleteRecipesByDrinkId(id);
        int deleted = drinkRepository.deleteDrinkById(id);
        if (deleted == 0) {
            throw new RuntimeException("Drink not found with id: " + id);
        }
    }
}