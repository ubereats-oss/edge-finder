@echo off
REM Agendador de histórico de odds — roda 2x por dia (12:00 e 20:00)
REM Execute este arquivo UMA VEZ como Administrador para configurar o agendamento

set PASTA=C:\Users\Alex Salles\Apps - desenvolvimento\odds_app
set NODE=node

schtasks /create /tn "EdgeFinder_HistoricoOdds_Manha" ^
  /tr "%NODE% \"%PASTA%\save_odds_history.js\" >> \"%PASTA%\odds_history\log.txt\" 2>&1" ^
  /sc daily /st 12:00 /f

schtasks /create /tn "EdgeFinder_HistoricoOdds_Noite" ^
  /tr "%NODE% \"%PASTA%\save_odds_history.js\" >> \"%PASTA%\odds_history\log.txt\" 2>&1" ^
  /sc daily /st 20:00 /f

echo.
echo Tarefas agendadas com sucesso:
echo   - EdgeFinder_HistoricoOdds_Manha (12:00 diario)
echo   - EdgeFinder_HistoricoOdds_Noite (20:00 diario)
echo.
pause
