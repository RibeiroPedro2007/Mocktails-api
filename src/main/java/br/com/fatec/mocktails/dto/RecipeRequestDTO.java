package br.com.fatec.mocktails.dto;

import lombok.Data;

@Data
public class RecipeRequestDTO {
    private Long ingredientId;
    private Double quantityMl;
    private Long dosageTimeMs;
}