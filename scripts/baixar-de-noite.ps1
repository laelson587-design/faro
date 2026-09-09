# Baixa a base da Receita durante a noite, com o notebook fechado.
#
#   powershell -ExecutionPolicy Bypass -File scripts\baixar-de-noite.ps1 -Uf SP
#
# O Windows dorme em 15 minutos na tomada e ao fechar a tampa, e conexao que
# dorme derruba o download. Este script muda as duas coisas, roda, e DEVOLVE
# COMO ESTAVA no fim — inclusive se der erro no meio, por causa do try/finally.
#
# Mesmo assim, se dormir por qualquer outro motivo, nada se perde: o montador
# salva o progresso a cada lote e continua de onde parou na proxima vez.

param(
  [string]$Uf = "",
  [string]$Cidades = ""
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot

# GUIDs do Windows para "ao fechar a tampa" e "suspender por inatividade".
$SUB_BOTOES = "4f971e89-eebd-4455-a8de-9e59040e7347"
$TAMPA      = "5ca83367-6e45-459f-a27b-476b1d01c936"
$SUB_SONO   = "238c9fa8-0aad-41ed-83f4-97be242c8f20"
$OCIOSO     = "29f6c1db-86da-48c5-9fdb-f2b67b1f44da"

# Le o valor atual (na tomada e na bateria) de uma configuracao de energia.
function Ler-Energia($sub, $cfg) {
  $saida = powercfg /query SCHEME_CURRENT $sub $cfg 2>$null | Out-String
  $hex = [regex]::Matches($saida, "0x[0-9a-fA-F]{8}")
  if ($hex.Count -lt 5) { return $null }
  # A ordem e: minimo, maximo, incremento, ATUAL-tomada, ATUAL-bateria.
  return @{ ac = $hex[3].Value; dc = $hex[4].Value }
}

$tampaAntes = Ler-Energia $SUB_BOTOES $TAMPA
$sonoAntes  = Ler-Energia $SUB_SONO $OCIOSO

Write-Output "Como esta agora:"
if ($tampaAntes) { Write-Output "  tampa fechada .... $($tampaAntes.ac) na tomada" }
                   Write-Output "  dorme depois de .. $([Convert]::ToInt32($sonoAntes.ac,16)) segundos na tomada"
Write-Output ""

try {
  Write-Output "Segurando o notebook acordado..."
  if ($tampaAntes) {
    powercfg /setacvalueindex SCHEME_CURRENT $SUB_BOTOES $TAMPA 0 | Out-Null
    powercfg /setdcvalueindex SCHEME_CURRENT $SUB_BOTOES $TAMPA 0 | Out-Null
  }
  powercfg /setacvalueindex SCHEME_CURRENT $SUB_SONO $OCIOSO 0 | Out-Null
  powercfg /setactive SCHEME_CURRENT | Out-Null
  Write-Output "  dorme por inatividade -> nunca (na tomada)"
  Write-Output ""
  if ($tampaAntes) {
    Write-Output "  tampa fechada -> nao faz nada"
    Write-Output "DEIXE NA TOMADA. Pode fechar a tampa e dormir."
  } else {
    # O Windows esconde esta configuracao em algumas maquinas, e mexer nela
    # exigiria desocultar por fora. Melhor dizer a verdade do que prometer.
    Write-Output "  tampa fechada -> NAO CONSEGUI MUDAR (o Windows esconde aqui)"
    Write-Output "DEIXE NA TOMADA E COM A TAMPA ABERTA."
    Write-Output "Se fechar, ele dorme e o download para — mas nada se perde:"
    Write-Output "rode de novo amanha e ele continua de onde parou."
  }
  Write-Output ""

  # NAO usar $args aqui: e variavel automatica do PowerShell.
  $passar = @()
  if ($Uf)      { $passar += @("--uf", $Uf) }
  if ($Cidades) { $passar += $Cidades.Split(",") }

  Push-Location $raiz
  node scripts/montar.js @passar
  Pop-Location
}
finally {
  # Devolve como estava, deu certo ou nao. Deixar o notebook sem dormir para
  # sempre gastaria bateria todo dia por causa de uma noite.
  Write-Output ""
  Write-Output "Devolvendo a energia como estava..."
  if ($tampaAntes) {
    powercfg /setacvalueindex SCHEME_CURRENT $SUB_BOTOES $TAMPA ([Convert]::ToInt32($tampaAntes.ac,16)) | Out-Null
    powercfg /setdcvalueindex SCHEME_CURRENT $SUB_BOTOES $TAMPA ([Convert]::ToInt32($tampaAntes.dc,16)) | Out-Null
  }
  powercfg /setacvalueindex SCHEME_CURRENT $SUB_SONO $OCIOSO ([Convert]::ToInt32($sonoAntes.ac,16)) | Out-Null
  powercfg /setdcvalueindex SCHEME_CURRENT $SUB_SONO $OCIOSO ([Convert]::ToInt32($sonoAntes.dc,16)) | Out-Null
  powercfg /setactive SCHEME_CURRENT | Out-Null
  Write-Output "  pronto, tudo como voce tinha."
}
