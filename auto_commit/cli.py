import sys
import typer
from typing import Optional
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from auto_commit.config import GEMINI_API_KEY, save_key_to_env
from auto_commit.git_ops import (
    get_git_diff,
    is_git_repo,
    commit_changes,
    stage_all_changes,
)
from auto_commit.llm_client import (
    LLMClient,
    LLMClientError,
    APIKeyMissingError,
    APIKeyInvalidError,
    APIQuotaExceededError,
    APIRequestError,
)

EXIT_SUCCESS = 0
EXIT_NOT_GIT_REPO = 1
EXIT_STAGE_FAILED = 2
EXIT_NO_CHANGES = 3
EXIT_API_KEY_MISSING = 10
EXIT_API_KEY_INVALID = 11
EXIT_QUOTA_EXCEEDED = 12
EXIT_API_ERROR = 13
EXIT_COMMIT_FAILED = 20
EXIT_UNKNOWN_ERROR = 99

app = typer.Typer(
    help="Auto-Commit CLI: Generate conventional commit messages using LLMs.",
    no_args_is_help=True,
)
console = Console(stderr=True)


def print_error(message: str, error_code: str = None):
    """Print error message to stderr with optional error code."""
    code_prefix = f"[{error_code}] " if error_code else ""
    console.print(f"[bold red]Error:[/bold red] {code_prefix}{message}")


@app.command("generate")
def generate(
    provider: str = typer.Option("gemini", help="LLM Provider: 'gemini'"),
    model: Optional[str] = typer.Option(None, help="Specific model to use (optional)"),
    yes: bool = typer.Option(
        False,
        "--yes",
        "-y",
        help="Auto-commit without confirmation (use with caution)",
    ),
    staged: bool = typer.Option(
        True,
        help="Use staged changes (default) or all changes (flag not implemented yet, always True)",
    ),
    print_only: bool = typer.Option(
        False, "--print-only", help="Only print the generated message to stdout"
    ),
):
    if not is_git_repo():
        print_error(
            "Not a git repository. Please run this command inside a git repository.",
            "NOT_GIT_REPO",
        )
        raise typer.Exit(code=EXIT_NOT_GIT_REPO)

    if not print_only:
        with console.status("[bold green]Staging all changes...[/bold green]"):
            if not stage_all_changes():
                print_error("Failed to stage changes.", "STAGE_FAILED")
                raise typer.Exit(code=EXIT_STAGE_FAILED)
    else:
        if not stage_all_changes():
            print_error("Failed to stage changes.", "STAGE_FAILED")
            raise typer.Exit(code=EXIT_STAGE_FAILED)

    if not print_only:
        with console.status("[bold green]Reading staged changes...[/bold green]"):
            diff = get_git_diff(staged=True)
    else:
        diff = get_git_diff(staged=True)

    if not diff:
        print_error(
            "No changes found. Make sure you have modified files in the repository.",
            "NO_CHANGES",
        )
        raise typer.Exit(code=EXIT_NO_CHANGES)

    if provider != "gemini":
        print_error(
            f"Provider '{provider}' is not supported. Use 'gemini'.",
            "UNSUPPORTED_PROVIDER",
        )
        raise typer.Exit(code=EXIT_UNKNOWN_ERROR)

    current_key = GEMINI_API_KEY
    key_name = "GEMINI_API_KEY"

    if not current_key:
        if print_only:
            print_error(
                f"{key_name} is not set. Please set the environment variable or configure it in VS Code.",
                "API_KEY_MISSING",
            )
            raise typer.Exit(code=EXIT_API_KEY_MISSING)
        else:
            console.print(f"[yellow]Missing {key_name}.[/yellow]")
            current_key = Prompt.ask(
                f"Please enter your {provider} API Key", password=True, console=console
            )
            if current_key:
                save_key_to_env(key_name, current_key)
                console.print("[green]API Key saved successfully to .env[/green]")
            else:
                print_error(
                    f"{key_name} is required to use {provider}.",
                    "API_KEY_MISSING",
                )
                raise typer.Exit(code=EXIT_API_KEY_MISSING)

    try:
        if print_only:
            client = LLMClient(provider=provider, model=model, api_key=current_key)
            message = client.generate_commit_message(diff)
            print(message)
            return

        with console.status(
            f"[bold green]Generating commit message with {provider}...[/bold green]"
        ):
            client = LLMClient(provider=provider, model=model, api_key=current_key)
            message = client.generate_commit_message(diff)

        console.print(
            Panel(message, title="Generated Commit Message", border_style="green")
        )

        if yes:
            should_commit = True
        else:
            should_commit = Confirm.ask(
                "Do you want to commit with this message?", console=console
            )

        if should_commit:
            if commit_changes(message):
                console.print("[bold green]Success![/bold green] Changes committed.")
            else:
                print_error("Failed to commit changes.", "COMMIT_FAILED")
                raise typer.Exit(code=EXIT_COMMIT_FAILED)
        else:
            console.print("[yellow]Operation aborted.[/yellow]")

    except APIKeyMissingError as e:
        print_error(str(e), e.error_code)
        raise typer.Exit(code=EXIT_API_KEY_MISSING)
    except APIKeyInvalidError as e:
        print_error(str(e), e.error_code)
        raise typer.Exit(code=EXIT_API_KEY_INVALID)
    except APIQuotaExceededError as e:
        print_error(str(e), e.error_code)
        raise typer.Exit(code=EXIT_QUOTA_EXCEEDED)
    except APIRequestError as e:
        print_error(str(e), e.error_code)
        raise typer.Exit(code=EXIT_API_ERROR)
    except LLMClientError as e:
        print_error(str(e), e.error_code)
        raise typer.Exit(code=EXIT_UNKNOWN_ERROR)
    except typer.Exit:
        raise
    except Exception as e:
        print_error(f"Unexpected error: {str(e)}", "UNKNOWN")
        raise typer.Exit(code=EXIT_UNKNOWN_ERROR)


@app.command("version")
def version():
    """Show the version of the tool."""
    console.print("Auto-Commit v1.0.0")


if __name__ == "__main__":
    app()
