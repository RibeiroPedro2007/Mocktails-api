package br.com.fatec.mocktails.repositories;

import br.com.fatec.mocktails.models.Drink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface DrinkRepository extends JpaRepository<Drink, Long> {
    List<Drink> findByActiveTrue(); //Get it ready for the menu(cardápio)
}
