package br.com.fatec.mocktails.dto;

import lombok.Data;

@Data
public class OrderRequestDTO {
    private Long drinkId;
    private Integer copos;

public Integer getCopos() { return copos; }
public void setCopos(Integer copos) { this.copos = copos; }
}
