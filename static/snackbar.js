/**
 * Simple Snackbar notification system
 */
class SnackbarManager {
    constructor() {
        this.container = null;
        this.snackbars = [];
        this.styleAdded = false;
        this.pendingMessages = [];
        this.initialized = false;
        
        // Initialize immediately if document body exists, otherwise wait for DOM ready
        if (document.body) {
            this.initialize();
        } else {
            // Wait for DOM to be ready
            document.addEventListener('DOMContentLoaded', () => {
                this.initialize();
                // Process any pending messages
                this.pendingMessages.forEach(msg => {
                    this.show(msg.message, msg.type, msg.duration);
                });
                this.pendingMessages = [];
            });
        }
    }

    initialize() {
        if (this.initialized) return;
        this.initialized = true;
        
        // Create container for snackbars
        this.container = document.createElement('div');
        this.container.className = 'snackbar-container';
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .snackbar-container {
                position: fixed;
                top: 10px;
                right: 10px;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-width: 320px;
                font-family: Arial, sans-serif;
            }
            
            .snackbar {
                padding: 12px 16px;
                border-radius: 4px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
                color: white;
                display: flex;
                align-items: center;
                transition: transform 0.3s ease-out, opacity 0.3s ease-out, margin-top 0.3s ease-out;
                overflow: hidden;
                max-width: 100%;
                box-sizing: border-box;
                animation: snackbar-in 0.3s forwards;
            }
            
            .snackbar.removing {
                animation: snackbar-out 0.3s forwards;
            }
            
            .snackbar-icon {
                margin-right: 12px;
                font-size: 18px;
            }
            
            .snackbar-message {
                flex: 1;
                word-break: break-word;
            }
            
            .snackbar-error {
                background-color: #d32f2f;
            }
            
            .snackbar-warning {
                background-color: #f57c00;
            }
            
            .snackbar-info {
                background-color: #0288d1;
            }
            
            @keyframes snackbar-in {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            @keyframes snackbar-out {
                from {
                    transform: translateX(0);
                    opacity: 1;
                    margin-top: 0;
                    max-height: 100px;
                    padding: 12px 16px;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                    margin-top: -8px;
                    max-height: 0;
                    padding: 0 16px;
                }
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(this.container);
    }

    /**
     * Show a snackbar notification
     * @param {string} message - The message to display
     * @param {string} type - Type of notification: 'error', 'warning', or 'info'
     * @param {number} duration - Duration in milliseconds
     */
    show(message, type = 'info', duration = 4000) {
        // If not initialized yet, queue the message
        if (!this.initialized) {
            this.pendingMessages.push({ message, type, duration });
            return null;
        }
        
        // Create snackbar element
        const snackbar = document.createElement('div');
        snackbar.className = `snackbar snackbar-${type}`;
        
        // Add icon based on type
        const icon = document.createElement('span');
        icon.className = 'snackbar-icon';
        
        switch (type) {
            case 'error':
                icon.textContent = '❌'; // Error icon
                break;
            case 'warning':
                icon.textContent = '⚠️'; // Warning icon
                break;
            default:
                icon.textContent = 'ℹ️'; // Info icon
                break;
        }
        
        // Add message
        const messageElement = document.createElement('span');
        messageElement.className = 'snackbar-message';
        messageElement.textContent = message;
        
        // Assemble snackbar
        snackbar.appendChild(icon);
        snackbar.appendChild(messageElement);
        
        // Add to DOM
        this.container.appendChild(snackbar);
        this.snackbars.push(snackbar);
        
        // Set timeout to remove
        setTimeout(() => {
            this.removeSnackbar(snackbar);
        }, duration);
        
        return snackbar;
    }

    /**
     * Show an error snackbar
     * @param {string} message - The error message
     */
    error(message) {
        return this.show(message, 'error');
    }

    /**
     * Show a warning snackbar
     * @param {string} message - The warning message
     */
    warning(message) {
        return this.show(message, 'warning');
    }

    /**
     * Show an info snackbar
     * @param {string} message - The info message
     */
    info(message) {
        return this.show(message, 'info');
    }

    /**
     * Remove a snackbar
     * @param {Element} snackbar - The snackbar element to remove
     */
    removeSnackbar(snackbar) {
        if (!snackbar) return;
        
        snackbar.classList.add('removing');
        
        // Remove from array
        const index = this.snackbars.indexOf(snackbar);
        if (index !== -1) {
            this.snackbars.splice(index, 1);
        }
        
        // Remove from DOM after animation completes
        setTimeout(() => {
            if (snackbar && snackbar.parentNode) {
                snackbar.parentNode.removeChild(snackbar);
            }
        }, 300); // Animation duration
    }
}

// Create global instance
const snackbar = new SnackbarManager();

// Helper functions for global use
function showError(message) {
    return snackbar.error(message);
}

function showWarning(message) {
    return snackbar.warning(message);
}

function showInfo(message) {
    return snackbar.info(message);
}

/**
 * Custom confirmation dialog to replace browser's native confirm()
 * Returns a Promise that resolves to true (confirm) or false (cancel)
 * @param {string} message - The confirmation message to display
 * @param {string} confirmText - Text for the confirm button
 * @param {string} cancelText - Text for the cancel button
 * @returns {Promise<boolean>}
 */
function showConfirm(message, confirmText = 'Yes', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.style.position = 'fixed';
        backdrop.style.top = '0';
        backdrop.style.left = '0';
        backdrop.style.right = '0';
        backdrop.style.bottom = '0';
        backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        backdrop.style.zIndex = '10000';
        backdrop.style.display = 'flex';
        backdrop.style.justifyContent = 'center';
        backdrop.style.alignItems = 'center';
        
        // Create dialog
        const dialog = document.createElement('div');
        dialog.style.backgroundColor = 'white';
        dialog.style.borderRadius = '8px';
        dialog.style.padding = '20px';
        dialog.style.width = '90%';
        dialog.style.maxWidth = '400px';
        dialog.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.2)';
        dialog.style.textAlign = 'center';
        dialog.style.fontFamily = 'Arial, sans-serif';
        
        // Add message
        const messageEl = document.createElement('p');
        messageEl.style.margin = '0 0 20px 0';
        messageEl.style.fontSize = '16px';
        messageEl.style.color = '#333';
        messageEl.textContent = message;
        
        // Button container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'center';
        buttonContainer.style.gap = '15px';
        
        // Base button styles
        const buttonStyle = {
            padding: '10px 20px',
            borderRadius: '5px',
            border: 'none',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
            flex: '1',
            maxWidth: '150px'
        };
        
        // Create confirm button
        const confirmButton = document.createElement('button');
        Object.assign(confirmButton.style, buttonStyle);
        confirmButton.style.backgroundColor = '#4a9eff'; // Blue
        confirmButton.style.color = 'white';
        confirmButton.textContent = confirmText;
        confirmButton.addEventListener('click', () => {
            document.body.removeChild(backdrop);
            resolve(true);
        });
        
        // Create cancel button
        const cancelButton = document.createElement('button');
        Object.assign(cancelButton.style, buttonStyle);
        cancelButton.style.backgroundColor = '#f2f2f2'; // Light gray
        cancelButton.style.color = '#333';
        cancelButton.textContent = cancelText;
        cancelButton.addEventListener('click', () => {
            document.body.removeChild(backdrop);
            resolve(false);
        });
        
        // Add hover effects
        confirmButton.addEventListener('mouseover', () => {
            confirmButton.style.backgroundColor = '#0069d9';
        });
        confirmButton.addEventListener('mouseout', () => {
            confirmButton.style.backgroundColor = '#4a9eff';
        });
        
        cancelButton.addEventListener('mouseover', () => {
            cancelButton.style.backgroundColor = '#e6e6e6';
        });
        cancelButton.addEventListener('mouseout', () => {
            cancelButton.style.backgroundColor = '#f2f2f2';
        });
        
        // Assemble dialog
        buttonContainer.appendChild(cancelButton); // Cancel first
        buttonContainer.appendChild(confirmButton); // Confirm second (right side)
        dialog.appendChild(messageEl);
        dialog.appendChild(buttonContainer);
        backdrop.appendChild(dialog);
        
        // Add to DOM
        document.body.appendChild(backdrop);
        
        // Focus confirm button
        confirmButton.focus();
    });
} 