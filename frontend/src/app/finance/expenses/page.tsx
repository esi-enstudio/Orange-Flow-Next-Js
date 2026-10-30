"use client";

import { useLanguage } from "@/i18n/useLanguage";

export default function ExpensesPage() {
    const { t } = useLanguage();
    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold">Expenses</h1>
            <p className="text-gray-500 mt-2">Expenses page coming soon</p>
        </div>
    );
}
