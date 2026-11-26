package br.com.fatec.mocktails.repositories;

import br.com.fatec.mocktails.models.Ingredient;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface IngredientRepository extends JpaRepository<Ingredient, Long> {
    @Modifying
    @Query("UPDATE Ingredient i SET i.currentQuantityMl = :qty WHERE i.id = :id")
    int updateStockById(@Param("id") Long id, @Param("qty") Integer qty); // use Double se na sua entidade for Double
}
