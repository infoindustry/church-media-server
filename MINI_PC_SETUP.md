# Установка на мини-ПК

## 1. Подготовка

Установите Node.js LTS.

Проверьте:

```bash
node -v
npm -v
```

## 2. Запуск

```bash
npm install
npm run build
npm start
```

После запуска:

- TV Screen: `http://localhost:4000/screen/main`
- Admin: `http://localhost:4000/admin`

## 3. Как открыть с телефона

На мини-ПК узнайте IP-адрес.

Windows:

```bash
ipconfig
```

macOS/Linux:

```bash
ifconfig
```

Потом на телефоне в той же Wi-Fi сети откройте:

```txt
http://IP-АДРЕС:4000/admin
```

Например:

```txt
http://192.168.1.50:4000/admin
```

## 4. Fullscreen на ТВ

Откройте на мини-ПК:

```txt
http://localhost:4000/screen/main
```

Нажмите fullscreen в браузере:

- Windows/Linux: `F11`
- macOS: `Ctrl + Cmd + F`

## 5. Практический порядок перед служением

1. Запустить сервер.
2. Открыть TV Screen на телевизоре.
3. Открыть админку на телефоне.
4. В разделе `Песни` добавить нужные локальные видео.
5. Добавить песни в `План`.
6. Добавить Писание, QR перевода и объявления.
7. Открыть `Проверка`.
8. Если ошибок нет — можно начинать.
9. Во время служения нажимать `Следующий`.

## 6. Что бэкапить

```txt
server/data/store.json
server/media/
```

## 7. Важно

Локальная Wi‑Fi сеть может работать даже без интернета. Главное, чтобы телефон и мини-ПК были подключены к одному роутеру.

## Welcome screen on TV

The TV should always open:

```txt
http://localhost:4000/screen/main
```

Chrome kiosk command is only a launch command:

```bash
chrome --kiosk --autoplay-policy=no-user-gesture-required http://localhost:4000/screen/main
```

The audience will see the configured welcome screen with the church name, not the command text.

Configure it in Admin:

```txt
/admin → Приветствие
```
