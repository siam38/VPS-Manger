# VPS Manager by Siam

## Overview

VPS Manager is a web-based control panel designed to simplify the management of your Virtual Private Servers (VPS). It provides a comprehensive suite of tools for system monitoring, file management, terminal access, process control, PM2 application management, and Git repository synchronization, all accessible through a modern and intuitive web interface.

## Features

*   **System Monitoring**: Real-time insights into CPU, memory, disk, and network usage.
*   **File Manager**: Browse, edit, upload, download, rename, copy, and delete files and directories directly from your browser.
*   **Terminal Access**: Secure web-based terminal for executing commands on your VPS.
*   **Process Manager**: View and manage running processes, including the ability to kill processes.
*   **PM2 Integration**: Full control over PM2-managed Node.js applications, including starting, stopping, restarting, deleting, and viewing logs. Supports smart restarts based on file changes.
*   **Git Synchronization**: Manage Git repositories, including cloning, pulling, pushing, and resolving conflicts. Integrates with PM2 for automatic application restarts on code updates.
*   **Authentication**: Secure login with IP lockout and JWT-based authentication.
*   **Audit Logging**: Tracks significant actions for security and monitoring purposes.

## Installation

### Prerequisites

Before you begin, ensure your VPS has the following installed:

*   **Node.js** (LTS version recommended)
*   **npm** or **Yarn**
*   **PM2**: A production process manager for Node.js applications.
    ```bash
    npm install -g pm2
    ```
*   **Git**: Version control system.

### Setup Steps

1.  **Clone the Repository**:

    ```bash
    git clone https://github.com/siam38/VPS-Manger.git
    cd VPS-Manger
    ```

2.  **Install Dependencies**:

    ```bash
    npm install
    # or
    yarn install
    ```

3.  **Environment Variables**:

    Create a `.env` file in the root directory of the project with the following variables:

    ```env
    PORT=48292
    PASSWORD=your_secure_password_here
    JWT_SECRET=your_long_and_random_jwt_secret_here
    ```

    *   `PORT`: The port on which the VPS Manager server will listen. Default is `48292`.
    *   `PASSWORD`: The password required to log in to the web interface. **Change this to a strong, unique password.**
    *   `JWT_SECRET`: A secret key used for signing JSON Web Tokens. **Generate a long, random string for this.**

4.  **Build the Frontend**:

    ```bash
    npm run build
    # or
    yarn build
    ```

5.  **Start the Backend Server**:

    ```bash
    npm run start
    # or
    yarn start
    ```

    The server will start on the configured `PORT`.

6.  **Running with PM2 (Recommended for Production)**:

    For continuous operation and process management, it is highly recommended to run VPS Manager using PM2.

    ```bash
    pm2 start server/index.cjs --name "vps-manager-backend"
    pm2 save
    ```

    This will start the backend server and ensure it restarts automatically if it crashes or after a system reboot.

## Usage

Once the server is running, open your web browser and navigate to `http://your_vps_ip:PORT` (replace `your_vps_ip` and `PORT` with your actual VPS IP address and the configured port).

Log in using the password you set in the `.env` file. Explore the dashboard for system metrics, use the file manager, open a terminal, manage your PM2 applications, and set up Git synchronization for your projects.

## Security Considerations

*   **Strong Passwords**: Always use strong, unique passwords for the `PASSWORD` and `JWT_SECRET` environment variables.
*   **HTTPS**: For production environments, it is crucial to set up HTTPS using a reverse proxy like Nginx or Apache. The project does not include built-in HTTPS certificate management for security reasons (to avoid shipping default or easily compromised certificates).
*   **Firewall**: Configure your VPS firewall to only allow access to the VPS Manager port (`PORT`) from trusted IP addresses.
*   **Audit Logs**: Regularly review the audit logs (`audit.log` in the server directory) for any suspicious activity.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues on the GitHub repository.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
