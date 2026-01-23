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
from auto_commit.llm_client import LLMClient

app = typer.Typer(
    help="Auto-Commit CLI: Generate conventional commit messages using LLMs.",
    no_args_is_help=True,
)
console = Console()


@app.command("generate")
def generate(
    provider: str = typer.Option("gemini", help="LLM Provider: 'gemini'"),
    model: Optional[str] = typer.Option(None, help="Specific model to use (optional)"),
    yes: bool = typer.Option(
        False, "--yes", "-y", help="Auto-commit without confirmation (use with caution)"
    ),
    staged: bool = typer.Option(
        True,
        help="Use staged changes (default) or all changes (flag not implemented yet, always True)",
    ),
):
    """
    Generate a commit message based on staged changes.
    """
    if not is_git_repo():
        console.print("[bold red]Error:[/bold red] Not a git repository.")
        raise typer.Exit(code=1)

    with console.status("[bold green]Staging all changes...[/bold green]"):
        if not stage_all_changes():
            console.print("[bold red]Error:[/bold red] Failed to stage changes.")
            raise typer.Exit(code=1)

    with console.status("[bold green]Reading staged changes...[/bold green]"):
        diff = get_git_diff(staged=True)

    if not diff:
        console.print(
            "[yellow]No changes found.[/yellow] Make sure you have modified files in the repository."
        )
        raise typer.Exit(code=0)

    if len(diff) > 10000:
        console.print(
            "[yellow]Warning:[/yellow] The diff is very large. The LLM might truncate it or hallucinate."
        )

    console.print(f"[blue]Using provider: {provider}[/blue]")

    # API Key check and prompt
    if provider == "gemini":
        current_key = GEMINI_API_KEY
        key_name = "GEMINI_API_KEY"
    else:
        console.print(f"[bold red]Error:[/bold red] Provider {provider} is no longer supported.")
        raise typer.Exit(code=1)

    if not current_key:
        console.print(f"[yellow]Missing {key_name}.[/yellow]")
        current_key = Prompt.ask(f"Please enter your {provider} API Key", password=True)
        if current_key:
            save_key_to_env(key_name, current_key)
            console.print("[green]API Key saved successfully to .env[/green]")
        else:
            console.print(f"[bold red]Error:[/bold red] {key_name} is required to use {provider}.")
            raise typer.Exit(code=1)

    try:
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
            should_commit = Confirm.ask("Do you want to commit with this message?")

        if should_commit:
            if commit_changes(message):
                console.print("[bold green]Success![/bold green] Changes committed.")
            else:
                console.print("[bold red]Failed to commit.[/bold red]")
        else:
            console.print("[yellow]Operation aborted.[/yellow]")

    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        raise typer.Exit(code=1)


@app.command("version")
def version():
    """Show the version of the tool."""
    console.print("Auto-Commit v1.0.0")


if __name__ == "__main__":
    app()
