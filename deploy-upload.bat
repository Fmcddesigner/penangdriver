@echo off
echo ============================================
echo  Upload ke GitHub - penangdriver
echo ============================================
echo.
echo Ganti YOUR_USERNAME dengan nama GitHub anda
echo Contoh: git remote add origin https://github.com/ali123/penangdriver.git
echo.
set /p GITHUB_USER="Masukkan nama GitHub anda: "
git remote remove origin 2>nul
git remote add origin https://github.com/%GITHUB_USER%/penangdriver.git
git push -u origin main
echo.
echo Selesai! Seterusnya deploy di render.com
pause
