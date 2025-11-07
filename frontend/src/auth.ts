import * as vscode from 'vscode';
import { APIClient } from './api';

export class AuthManager {
    private static readonly TOKEN_KEY = 'aiworkflowviz.token';

    constructor(
        private context: vscode.ExtensionContext,
        private api: APIClient
    ) {
        const token = this.getToken();
        if (token) {
            this.api.setToken(token);
        }
    }

    private getToken(): string | undefined {
        return this.context.globalState.get(AuthManager.TOKEN_KEY);
    }

    private async setToken(token: string) {
        await this.context.globalState.update(AuthManager.TOKEN_KEY, token);
        this.api.setToken(token);
    }

    private async clearToken() {
        await this.context.globalState.update(AuthManager.TOKEN_KEY, undefined);
        this.api.clearToken();
    }

    async login() {
        const email = await vscode.window.showInputBox({
            prompt: 'Enter your email',
            placeHolder: 'email@example.com'
        });
        if (!email) return;

        const password = await vscode.window.showInputBox({
            prompt: 'Enter your password',
            password: true
        });
        if (!password) return;

        try {
            const token = await this.api.login(email, password);
            await this.setToken(token);
            vscode.window.showInformationMessage('Logged in successfully');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Login failed: ${error.response?.data?.detail || error.message}`);
        }
    }

    async register() {
        const email = await vscode.window.showInputBox({
            prompt: 'Enter your email',
            placeHolder: 'email@example.com'
        });
        if (!email) return;

        const password = await vscode.window.showInputBox({
            prompt: 'Enter your password (min 8 chars)',
            password: true
        });
        if (!password) return;

        try {
            const token = await this.api.register(email, password);
            await this.setToken(token);
            vscode.window.showInformationMessage('Registered successfully! Free trial: 10 requests/day');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Registration failed: ${error.response?.data?.detail || error.message}`);
        }
    }

    async logout() {
        await this.clearToken();
        vscode.window.showInformationMessage('Logged out');
    }

    isAuthenticated(): boolean {
        return !!this.getToken();
    }
}
