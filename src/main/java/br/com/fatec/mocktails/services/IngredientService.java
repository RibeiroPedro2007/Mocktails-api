package br.com.fatec.mocktails.services;

import br.com.fatec.mocktails.dto.StockUpdateDTO;
import br.com.fatec.mocktails.models.Ingredient;
import br.com.fatec.mocktails.repositories.IngredientRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class IngredientService {

    @Autowired
    private IngredientRepository ingredientRepository;

    public List<Ingredient> findAll() {
        return ingredientRepository.findAll();
    }

    public Ingredient findById(Long id) {
        return ingredientRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Ingredient not found with id: " + id));
    }

    @Transactional
    public Ingredient save(Ingredient ingredient) {
        return ingredientRepository.save(ingredient);
    }

    @Transactional
    public Ingredient update(Long id, Ingredient updatedData) {
        Ingredient ingredient = findById(id);
        if (updatedData.getName() != null && !updatedData.getName().isBlank()) {
            ingredient.setName(updatedData.getName().trim());
        }
        if (updatedData.getPump() != null && !updatedData.getPump().isBlank()) {
            ingredient.setPump(updatedData.getPump().trim().toUpperCase());
        }
        if (updatedData.getPumpPin() != null) {
            ingredient.setPumpPin(updatedData.getPumpPin());
        }
        if (updatedData.getMaxCapacityMl() != null) {
            ingredient.setMaxCapacityMl(updatedData.getMaxCapacityMl());
        }
        if (updatedData.getCurrentQuantityMl() != null) {
            ingredient.setCurrentQuantityMl(updatedData.getCurrentQuantityMl());
        }
        return ingredientRepository.save(ingredient);
    }

    @Transactional
    public Ingredient updateStock(Long id, StockUpdateDTO dto) {
        Ingredient ingredient = findById(id);
        ingredient.setCurrentQuantityMl(dto.getCurrentQuantityMl());
        return ingredientRepository.save(ingredient);
    }

    @Transactional
    public void delete(Long id) {
        Ingredient ingredient = findById(id);
        ingredientRepository.delete(ingredient);
        ingredientRepository.flush();
    }
}