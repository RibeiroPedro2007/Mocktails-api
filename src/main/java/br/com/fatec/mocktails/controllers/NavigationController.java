package br.com.fatec.mocktails.controllers;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class NavigationController {

    @GetMapping({"/", "/Operation"}) //When to access the root (http://localhost:8080/) or /Operation, because he is the main screen
    public String OperationScreen() {return "Operation";}

    @GetMapping("/Management")
    public String ManagementScreen() {return "Management";}
}
