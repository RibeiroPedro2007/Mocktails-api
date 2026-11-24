package br.com.fatec.mocktails.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PedidoControler {

    @GetMapping("/pedido")
    public String exibirPedido() {
        return "pedido";
    }
}