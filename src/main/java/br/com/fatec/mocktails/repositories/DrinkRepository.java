package br.com.fatec.mocktails.repositories;

import br.com.fatec.mocktails.models.Drink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface DrinkRepository extends JpaRepository<Drink, Long> {

    @Override
    @Query("SELECT DISTINCT d FROM Drink d " +
            "LEFT JOIN FETCH d.recipes r " +
            "LEFT JOIN FETCH r.ingredient")
    List<Drink> findAll();

    @Query("SELECT DISTINCT d FROM Drink d " +
            "LEFT JOIN FETCH d.recipes r " +
            "LEFT JOIN FETCH r.ingredient " +
            "WHERE d.active = true")
    List<Drink> findByActiveTrue();

    @Override
    @Query("SELECT DISTINCT d FROM Drink d " +
            "LEFT JOIN FETCH d.recipes r " +
            "LEFT JOIN FETCH r.ingredient " +
            "WHERE d.id = :id")
    Optional<Drink> findById(@Param("id") Long id);

    @Modifying
    @Query("UPDATE Drink d SET d.active = :active WHERE d.id = :id")
    int updateActiveStatus(@Param("id") Long id, @Param("active") Boolean active);

    @Modifying
    @Query("DELETE FROM Recipe r WHERE r.drink.id = :drinkId")
    void deleteRecipesByDrinkId(@Param("drinkId") Long drinkId);

    @Modifying
    @Query("DELETE FROM Drink d WHERE d.id = :id")
    int deleteDrinkById(@Param("id") Long id);
}