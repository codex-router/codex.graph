.PHONY: setup run stop debug

setup:
	@echo "Setting up backend..."
	cd backend && python -m venv venv && \
		. venv/bin/activate && \
		pip install -r requirements.txt
	@if [ ! -f backend/.env ]; then \
		cp backend/.env.example backend/.env; \
		echo "Created backend/.env - add your Gemini API key!"; \
	fi
	@echo "Setting up frontend..."
	cd frontend && npm install && npm run compile
	@echo "Setup complete!"

run:
	@echo "Compiling frontend..."
	cd frontend && npm run compile
	@echo "Starting backend..."
	@cd backend && . venv/bin/activate && \
		python main.py > ../backend.log 2>&1 & echo $$! > ../backend.pid && \
		echo "Backend running (PID: $$!)"
	@sleep 2
	@echo "Launching VSCode extension..."
	@code --extensionDevelopmentPath=$(PWD)/frontend $(PWD)

debug:
	@echo "Compiling frontend..."
	cd frontend && npm run compile
	@echo "Launching VSCode extension in debug mode..."
	@code --extensionDevelopmentPath=$(PWD)/frontend $(PWD)

stop:
	@echo "Stopping backend..."
	@if [ -f backend.pid ]; then \
		PID=$$(cat backend.pid); \
		if ps -p $$PID > /dev/null 2>&1; then \
			kill $$PID && echo "Stopped backend (PID: $$PID)"; \
		else \
			echo "PID $$PID not running (stale PID file)"; \
		fi; \
		rm backend.pid; \
	fi
	@if lsof -ti:8000 > /dev/null 2>&1; then \
		echo "Found process on port 8000, killing..."; \
		lsof -ti:8000 | xargs kill -9 2>/dev/null; \
		echo "Port 8000 cleared"; \
	else \
		echo "No process on port 8000"; \
	fi
