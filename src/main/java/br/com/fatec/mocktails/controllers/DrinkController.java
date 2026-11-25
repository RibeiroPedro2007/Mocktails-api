package br.com.fatec.mocktails.controllers;

import br.com.fatec.mocktails.dto.DrinkRequestDTO;
import br.com.fatec.mocktails.models.Drink;
import br.com.fatec.mocktails.services.DrinkService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/drinks")
public class DrinkController {

    @Autowired
    private DrinkService drinkService;

    @GetMapping
    public ResponseEntity<List<Drink>> getAllDrinks(
            @RequestParam(defaultValue = "false") boolean all) {
        List<Drink> drinks = drinkService.findAll(all);
        return ResponseEntity.ok(drinks);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Drink> getDrinkById(@PathVariable Long id) {
        Drink drink = drinkService.findById(id);
        return ResponseEntity.ok(drink);
    }

    @PostMapping
    public ResponseEntity<Drink> createDrink(@RequestBody DrinkRequestDTO dto) {
        Drink savedDrink = drinkService.create(dto);
        return ResponseEntity.status(201).body(savedDrink);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Drink> updateDrink(@PathVariable Long id, @RequestBody DrinkRequestDTO dto) {
        Drink updatedDrink = drinkService.update(id, dto);
        return ResponseEntity.ok(updatedDrink);
    }

    // Rota para alternar o status active (ex: /api/drinks/1/status?active=false)
    @PatchMapping("/{id}/status")
    public ResponseEntity<Void> updateDrinkStatus(@PathVariable Long id, @RequestParam Boolean active) {
        drinkService.SetDrinkActivation(id, active);
        return ResponseEntity.noContent().build();
    }

    // Rota para deletar o drink fisicamente do banco
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteDrink(@PathVariable Long id) {
        drinkService.delete(id);
        return ResponseEntity.noContent().build();
    }
}