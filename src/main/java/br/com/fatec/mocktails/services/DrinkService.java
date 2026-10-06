package br.com.fatec.mocktails.services;

import br.com.fatec.mocktails.dto.DrinkRequestDTO;
import br.com.fatec.mocktails.dto.RecipeRequestDTO;
import br.com.fatec.mocktails.models.Drink;
import br.com.fatec.mocktails.models.Ingredient;
import br.com.fatec.mocktails.models.Recipe;
import br.com.fatec.mocktails.repositories.DrinkRepository;
import br.com.fatec.mocktails.repositories.IngredientRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class DrinkService {
    @Autowired
    private DrinkRepository drinkRepository;
    @Autowired
    private IngredientRepository ingredientRepository;

    public List<Drink> findAllActive() {
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

            if (dto.getRecipes() != null) {
                for (RecipeRequestDTO item : dto.getRecipes()) {
                    Ingredient ingredient = ingredientRepository.findById(item.getIngredientId())
                            .orElseThrow(() -> new RuntimeException("Ingredient not found with id: " + item.getIngredientId()));

                    Recipe recipe = new Recipe();
                    recipe.setDrink(drink);
                    recipe.setIngredient(ingredient);
                    recipe.setQuantityMl(item.getQuantityMl());
                    recipe.setDosageTimeMs(item.getDosageTimeMs());

                    drink.getRecipes().add(recipe);
                }
        }

        return drinkRepository.save(drink);
    }
}
