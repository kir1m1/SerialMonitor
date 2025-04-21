import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

let serialConnection = null;
let logStream = null;

async function main() {
  console.log(chalk.blue('==================================='));
  console.log(chalk.blue('       Serial Monitor CLI'));
  console.log(chalk.blue('==================================='));

  try {
    await showMainMenu();
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

async function showMainMenu() {
  if (serialConnection) {
    await showConnectedMenu();
  } else {
    await showDisconnectedMenu();
  }
}

async function showDisconnectedMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Connect to a device', value: 'connect' },
        { name: 'Exit', value: 'exit' }
      ]
    }
  ]);

  if (action === 'connect') {
    await connectToDevice();
  } else if (action === 'exit') {
    console.log(chalk.blue('Goodbye!'));
    process.exit(0);
  }
}

async function showConnectedMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: `Connected to ${serialConnection.path}. What would you like to do?`,
      choices: [
        { name: 'Disconnect', value: 'disconnect' },
        { name: 'Send command', value: 'send' },
        { name: 'Start/Stop logging to file', value: 'log' },
        { name: 'Exit', value: 'exit' }
      ]
    }
  ]);

  if (action === 'disconnect') {
    await disconnectFromDevice();
    await showMainMenu();
  } else if (action === 'send') {
    await sendCommand();
    await showConnectedMenu();
  } else if (action === 'log') {
    await toggleLogging();
    await showConnectedMenu();
  } else if (action === 'exit') {
    await disconnectFromDevice();
    console.log(chalk.blue('Goodbye!'));
    process.exit(0);
  }
}

async function connectToDevice() {
  try {
    // Get available ports
    const ports = await SerialPort.list();

    if (ports.length === 0) {
      console.log(chalk.yellow('No serial ports detected. Please connect a device.'));
      await showMainMenu();
      return;
    }

    // Create port choices with detailed information
    const portChoices = ports.map(port => ({
      name: `${port.path} - ${port.manufacturer || 'Unknown'} ${port.serialNumber ? `(SN: ${port.serialNumber})` : ''}`,
      value: port.path
    }));

    // Let user select a port
    const { selectedPort } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedPort',
        message: 'Select a serial port:',
        choices: portChoices
      }
    ]);

    // Let user select baud rate
    const { baudRate } = await inquirer.prompt([
      {
        type: 'list',
        name: 'baudRate',
        message: 'Select baud rate:',
        choices: [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600],
        default: 115200
      }
    ]);

    console.log(chalk.yellow(`Connecting to ${selectedPort} at ${baudRate} baud...`));

    // Create the serial connection
    serialConnection = new SerialPort({
      path: selectedPort,
      baudRate: parseInt(baudRate),
      dataBits: 8,
      stopBits: 1,
      parity: 'none'
    });

    // Set up parser for incoming data
    const parser = serialConnection.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    // Handle port events
    serialConnection.on('open', () => {
      console.debug('\n', chalk.green(`Connected to ${selectedPort} at ${baudRate} baud`));
    });

    serialConnection.on('error', (err) => {
      console.error(chalk.red(`Serial port error: ${err.message}`));
      serialConnection = null;
      showMainMenu();
    });

    serialConnection.on('close', () => {
      console.log(chalk.yellow('Serial connection closed'));
      serialConnection = null;
      if (logStream) {
        logStream.end();
        logStream = null;
      }
      showMainMenu();
    });

    // Display incoming data
    parser.on('data', (data) => {
      const timestamp = new Date().toISOString();
      console.log(chalk.cyan(`[${timestamp}] ${data}`));
      const streamMsg = `[${timestamp}] ${data}`;

      // Log to file if enabled
      if (logStream) {
        logStream.write(`${streamMsg}\n`);
      }
      console.debug(
        `\n ${streamMsg}`
      );
    });

    await showMainMenu();

  } catch (error) {
    console.error(chalk.red(`Connection error: ${error.message}`));
    serialConnection = null;
    await showMainMenu();
  }
}

async function disconnectFromDevice() {
  if (serialConnection) {
    return new Promise((resolve) => {
      serialConnection.close(() => {
        console.log(chalk.yellow('Disconnected from serial device'));
        serialConnection = null;
        if (logStream) {
          logStream.end();
          logStream = null;
          console.log(chalk.yellow('Logging stopped'));
        }
        resolve();
      });
    });
  }
}

async function sendCommand() {
  if (!serialConnection) {
    console.log(chalk.red('Not connected to any device'));
    return;
  }

  const { command } = await inquirer.prompt([
    {
      type: 'input',
      name: 'command',
      message: 'Enter command to send:',
    }
  ]);

  try {
    serialConnection.write(command + '\r\n');
    console.log(chalk.green(`Command sent: ${command}`));
  } catch (error) {
    console.error(chalk.red(`Failed to send command: ${error.message}`));
  }
}

async function toggleLogging() {
  if (logStream) {
    // Stop logging
    logStream.end();
    logStream = null;
    console.log(chalk.yellow('Logging stopped'));
  } else {
    // Start logging
    const { fileName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'fileName',
        message: 'Enter log file name:',
        default: `serial_log_${new Date().toISOString().replace(/:/g, '-')}.txt`
      }
    ]);

    try {
      const logDir = path.join(process.cwd(), 'logs');

      // Create logs directory if it doesn't exist
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir);
      }

      const logPath = path.join(logDir, fileName);
      logStream = fs.createWriteStream(logPath, { flags: 'a' });
      console.log(chalk.green(`Logging to ${logPath}`));
    } catch (error) {
      console.error(chalk.red(`Failed to create log file: ${error.message}`));
    }
  }
}

// Handle process exit
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\nGracefully shutting down...'));
  await disconnectFromDevice();
  process.exit(0);
});

// Start the application
main();
