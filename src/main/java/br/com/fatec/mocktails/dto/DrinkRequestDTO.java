package br.com.fatec.mocktails.dto;

import lombok.Data;
import java.util.List;

@Data
public class DrinkRequestDTO {
    private String name;
    private Boolean active = true;
    private List<RecipeRequestDTO> recipes;
}