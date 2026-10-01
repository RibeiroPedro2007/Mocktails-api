package br.com.fatec.mocktails.models;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;

//JPA
@Entity
@Table(name = "input")
//Lombook
@Data
@NoArgsConstructor
public class Input {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private Double currentQuantityMl;

    @Column(nullable = false)
    private Double maximumCapacityMl;

    @Column(nullable = false)
    private Integer pumpPin;
}
