package br.com.fatec.mocktails.models;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;

//JPA
@Entity
@Table(name = "recipe")
//Lombook
@Data
@NoArgsConstructor
public class Recipe {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "drink_id", nullable = false)
    private Drink drink;

    @ManyToOne
    @JoinColumn(name = "input_id", nullable = false)
    private Input input;

    @Column(nullable = false)
    private Double QuantityMl;

    @Column(nullable = false)
    private Long dosageTimeMs;
}