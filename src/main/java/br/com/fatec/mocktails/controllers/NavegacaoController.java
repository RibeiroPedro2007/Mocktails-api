package br.com.fatec.mocktails.controllers;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class NavegacaoController {

    @GetMapping({"/", "/operacao"}) //Quando acessar a raiz (http://localhost:8080/) ou /operacao, pois operação é a tela principal
    public String telaOperacao() {
        return "Operacao";
    }

    @GetMapping("/gerenciamento")
    public String telaGerenciamento() {
        return "Gerenciamento";
    }
}
