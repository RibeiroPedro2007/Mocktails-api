package br.com.fatec.mocktails.repositories;

import br.com.fatec.mocktails.models.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    @Override
    @Query("SELECT DISTINCT o FROM Order o " +
            "LEFT JOIN FETCH o.drink d " +
            "LEFT JOIN FETCH d.recipes r " +
            "LEFT JOIN FETCH r.ingredient")
    List<Order> findAll();

    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM Order o WHERE o.drink.id = :drinkId")
    void deleteByDrinkId(@Param("drinkId") Long drinkId);
}