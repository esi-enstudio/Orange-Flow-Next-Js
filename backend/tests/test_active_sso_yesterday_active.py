"""Active SSO: retailers that crossed the activation threshold on the reference day.

A retailer is Active SSO once it reaches the monthly activation threshold (2 by
default). The qualifying activations may land on the same day or on different
days of the month, so the count compares cumulative maps, never one day's rows.
"""
from app.services.active_sso_report_service import count_newly_active

THRESHOLD = 2


def test_two_activations_on_the_same_day_count():
    # Retailer 1: 0 before yesterday, 2 on yesterday -> newly active.
    assert count_newly_active([1], {1: 0}, {1: 2}, THRESHOLD) == 1


def test_two_activations_on_different_days_count():
    # Retailer 1: 1 on the 5th, 1 yesterday -> still newly active yesterday.
    assert count_newly_active([1], {1: 1}, {1: 2}, THRESHOLD) == 1


def test_retailer_already_active_is_not_counted_again():
    assert count_newly_active([1], {1: 2}, {1: 3}, THRESHOLD) == 0


def test_retailer_below_threshold_is_not_counted():
    assert count_newly_active([1], {1: 0}, {1: 1}, THRESHOLD) == 0


def test_retailer_jumping_past_threshold_counts():
    # A bulk import can push a retailer from 0 to 3 in one day.
    assert count_newly_active([1], {1: 0}, {1: 3}, THRESHOLD) == 1
