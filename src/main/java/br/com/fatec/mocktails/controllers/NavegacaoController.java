package br.com.fatec.mocktails.controllers;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class NavegacaoController {

    @GetMapping({"/", "/Operation"}) //Quando acessar a raiz (http://localhost:8080/) ou /operacao, pois operação é a tela principal
    public String OperationScreen() {return "Operation";}

    @GetMapping("/Management")
    public String ManagementScreen() {return "Management";}
}
