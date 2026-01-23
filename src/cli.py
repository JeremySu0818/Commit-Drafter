import typer
from typing import Optional
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm
from .git_ops import get_git_diff, is_git_repo, commit_changes
from .llm_client import LLMClient

app = typer.Typer(
    help="Auto-Commit CLI: Generate conventional commit messages using LLMs.",
    no_args_is_help=True,
)
console = Console()


@app.command("generate")
def generate(
    provider: str = typer.Option("gemini", help="LLM Provider: 'gemini' or 'openai'"),
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

    with console.status("[bold green]Reading staged changes...[/bold green]"):
        diff = get_git_diff(staged=True)

    if not diff:
        console.print(
            "[yellow]No staged changes found.[/yellow] Stage some files with `git add` first."
        )
        raise typer.Exit(code=0)

    if len(diff) > 10000:
        console.print(
            "[yellow]Warning:[/yellow] The diff is very large. The LLM might truncate it or hallucinate."
        )

    console.print(f"[blue]Using provider: {provider}[/blue]")

    try:
        with console.status(
            f"[bold green]Generating commit message with {provider}...[/bold green]"
        ):
            client = LLMClient(provider=provider, model=model)
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
    console.print("Auto-Commit CLI v0.1.0")


if __name__ == "__main__":
    app()
