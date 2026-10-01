package br.com.fatec.mocktails.models;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;

//JPA
@Entity
@Table(name = "ingredient")
//Lombok
@Data
@NoArgsConstructor
public class Ingredient {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private Double currentQuantityMl;

    @Column(nullable = false)
    private Double maxCapacityMl;

    @Column(nullable = false)
    private Integer pumpPin;
}
