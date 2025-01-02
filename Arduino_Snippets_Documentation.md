
# **Arduino Snippets for VS Code**

Welcome to the **Arduino Snippets Extension**! This extension provides a collection of snippets to streamline your Arduino development in Visual Studio Code. From basic syntax to advanced ESP32 functionalities, these snippets save time and reduce coding errors.

---

## **Table of Contents**
1. [Introduction](#introduction)
2. [Installation](#installation)
3. [Available Snippets](#available-snippets)
   - [Basic Arduino Snippets](#basic-arduino-snippets)
   - [ESP32-Specific Snippets](#esp32-specific-snippets)
4. [How to Use](#how-to-use)
5. [Contributing](#contributing)
6. [Changelog](#changelog)
7. [Support](#support)

---

## **Introduction**

This extension offers a wide range of Arduino programming snippets, including commonly used functions and advanced ESP32-specific features. It is ideal for beginners and experts alike, simplifying repetitive coding tasks.

---

## **Installation**

1. Open **Visual Studio Code**.
2. Navigate to the Extensions view (`Ctrl+Shift+X`).
3. Search for **Arduino Snippets**.
4. Click **Install**.

---

## **Available Snippets**

### **Basic Arduino Snippets**

| Prefix            | Description                                      |
|--------------------|--------------------------------------------------|
| `include`         | Insert a generic `#include` header file.          |
| `includeArduinoHeader` | Include the Arduino core header file (`<Arduino.h>`). |
| `setup`           | Create empty `setup` and `loop` functions with Serial initialization. |
| `analogRead`      | Read analog data from a specified pin.            |
| `analogWrite`     | Write an analog value to a specified pin.         |
| `define`          | Insert a `#define` directive.                    |
| `pinMode`         | Set up a pin as input, output, or with a pull-up resistor. |
| `serialBegin`     | Initialize Serial communication.                 |
| `delay`           | Add a delay in milliseconds.                     |
| `delayMicroseconds`| Add a delay in microseconds.                     |
| `digitalRead`     | Read a digital pin's state.                      |
| `digitalWrite`    | Write HIGH or LOW to a digital pin.              |
| `ifdef`           | Insert an `#ifdef` block for conditional compilation. |
| `random`          | Generate a random number within a range.         |

#### Example: Using the `setup` Snippet
```cpp
void setup() {
    // Initialize your setup code here
    Serial.begin(115200);
}

void loop() {
    // Add your main code here, to run repeatedly
}
```

---

### **ESP32-Specific Snippets**

| Prefix               | Description                                      |
|-----------------------|--------------------------------------------------|
| `taskCreatePinnedToCore` | Create a FreeRTOS task pinned to a specific core. |
| `TaskHandle_t`       | Declare a handle for task management.           |
| `taskFunction`       | Create a FreeRTOS task function with setup and loop sections. |
| `ledcAttach`         | Attach a pin to a PWM signal.                   |
| `ledcWrite`          | Set the duty cycle on a PWM pin.                |
| `ledcAttachChannel`  | Attach a pin to a specific PWM channel.         |
| `ledcWriteChannel`   | Set the duty cycle on a specific PWM channel.   |
| `ledcRead`           | Get the duty cycle of a pin.                    |
| `ledcReadFreq`       | Get the frequency of a pin's PWM signal.        |
| `ledcWriteTone`      | Generate a tone on a pin at a specified frequency. |
| `ledcWriteNote`      | Generate a musical note on a pin.               |
| `ledcDetach`         | Detach a PWM signal from a pin.                 |
| `ledcFade`           | Gradually adjust a pin's duty cycle.            |
| `analogWriteFrequency` | Set the PWM frequency for a pin.               |
| `analogWriteResolution` | Set the PWM resolution for a pin.             |

#### Example: Using the `taskCreatePinnedToCore` Snippet
```cpp
xTaskCreatePinnedToCore(
    taskFunction,     // Task function
    "MyTask",         // Task name
    8192,             // Stack size
    NULL,             // Task input parameters
    1,                // Task priority
    NULL,             // Task handle
    1                 // Core to run the task on
);
```

---

## **How to Use**

1. Open an Arduino file (`.ino`) in Visual Studio Code.
2. Start typing the snippet prefix (e.g., `setup`).
3. Select the desired snippet from IntelliSense or press `Tab` to expand it.
4. Customize the placeholders (e.g., pin numbers, values) as needed.

---

## **Contributing**

Contributions are welcome! To propose a new snippet or improve existing ones:
1. Fork the [GitHub repository](https://github.com/your-repo).
2. Create a new branch for your changes.
3. Submit a pull request.

---

## **Changelog**

### **Version 1.0.0**
- Initial release with basic Arduino and ESP32-specific snippets.

---

## **Support**

For questions, issues, or feature requests, reach out via:
- Email: support@example.com
- GitHub: [Issues Page](https://github.com/your-repo/issues)
