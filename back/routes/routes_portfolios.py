"""Portfolio CRUD — cross-cloud groupings persisted per authenticated user.

Portfolios are user-scoped bags of billing sources (AWS accounts, GCP
projects, Azure subscriptions) used by the frontend to compute consolidated
views. The server stores only identifiers + labels; no credentials.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from core.errors import NotFound
from core.portfolios import (
    create_portfolio,
    delete_portfolio,
    get_portfolio,
    list_portfolios,
    update_portfolio,
)
from core.session import require_current_user_id
from schemas.portfolios import Portfolio, PortfolioCreate, PortfolioUpdate


router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])


@router.get("", summary="List the current user's portfolios")
def list_(
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    portfolios = list_portfolios(user_id)
    return {"portfolios": [p.model_dump(mode="json") for p in portfolios]}


@router.get("/{portfolio_id}", response_model=Portfolio, summary="Read a portfolio by ID")
def get_one(
    portfolio_id: str,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> Portfolio:
    portfolio = get_portfolio(user_id, portfolio_id)
    if portfolio is None:
        raise NotFound("Portfolio not found.")
    return portfolio


@router.post("", response_model=Portfolio, status_code=201, summary="Create a portfolio")
def create(
    body: PortfolioCreate,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> Portfolio:
    return create_portfolio(user_id, name=body.name, members=body.members)


@router.put(
    "/{portfolio_id}",
    response_model=Portfolio,
    summary="Update a portfolio (partial — name and/or members)",
)
def update(
    portfolio_id: str,
    body: PortfolioUpdate,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> Portfolio:
    updated = update_portfolio(
        user_id, portfolio_id, name=body.name, members=body.members
    )
    if updated is None:
        raise NotFound("Portfolio not found.")
    return updated


@router.delete("/{portfolio_id}", status_code=204, summary="Delete a portfolio")
def delete(
    portfolio_id: str,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> None:
    delete_portfolio(user_id, portfolio_id)
    return None
