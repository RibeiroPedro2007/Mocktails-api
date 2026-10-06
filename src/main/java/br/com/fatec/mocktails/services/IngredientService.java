package br.com.fatec.mocktails.services;

import br.com.fatec.mocktails.dto.StockUpdateDTO;
import br.com.fatec.mocktails.models.Ingredient;
import br.com.fatec.mocktails.repositories.IngredientRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class IngredientService {

    @Autowired
    private IngredientRepository ingredientRepository;

    public List<Ingredient> findAll(){
        return ingredientRepository.findAll();
    }
    public Ingredient findById(Long id){
        return ingredientRepository.findById(id)
                .orElseThrow(()-> new RuntimeException("Ingredient not found with id: " + id));
    }
    public Ingredient save(Ingredient ingredient){
        return ingredientRepository.save(ingredient);
    }
    public Ingredient updateStock(Long id, StockUpdateDTO dto){
        Ingredient ingredient = findById(id);
        ingredient.setCurrentQuantityMl(dto.getCurrentQuantityMl());
        return ingredientRepository.save(ingredient);
    }
}
